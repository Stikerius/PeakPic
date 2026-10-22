// Supabase Edge Function: delete an account, finally and at once (no grace period).
//
// Two ways to call it:
//  (a) Self-deletion from the app: body {}. The account is ALWAYS the caller's own (taken from
//      the verified JWT, never from the request). The sign-in must be fresh: the token and the
//      last authentication (amr) at most 5 minutes old, otherwise "reauth_required".
//  (b) Admin deletion from the dashboard: body {target_user_id, username, reason}. The database
//      checks admin role + two-factor (aal2), the typed username and the reason, refuses the
//      own account and staff accounts, and logs the action.
//
// Steps (each one safe to repeat, so an interrupted deletion can simply be retried):
//  1) request_account_deletion() / admin_request_account_deletion() with the CALLER's session:
//     checks, then account_status = 'deleting' (hidden at once, no more writes)
//  2) delete every file under {user_id}/ in every storage bucket (in batches)
//  3) finish_account_deletion(): pseudonymise logs, write account_deletions
//  4) delete the auth user; all rows of the account go with it (on delete cascade)
//
// The service_role key (SUPABASE_SERVICE_ROLE_KEY, provided by Supabase) is used only for
// steps 2-4: storage management and the Auth admin API. Nothing about the user is logged.
//
// Deploy: npx supabase functions deploy delete_account
// Secret (optional): ADMIN_ORIGIN=http://127.0.0.1:5174 (where the dashboard runs)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRESH_SECONDS = 5 * 60;
const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
// Upper bound per call; with more files the call answers "partial" and is simply repeated.
const MAX_FILES_PER_CALL = 20000;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": Deno.env.get("ADMIN_ORIGIN") ?? "http://127.0.0.1:5174",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

/** Payload of a JWT that auth.getUser() has already verified. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (part === undefined) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const value: unknown = JSON.parse(atob(base64));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Token issued and last sign-in (amr) both at most FRESH_SECONDS ago. */
function isFreshSignIn(payload: Record<string, unknown>): boolean {
  const now = Math.floor(Date.now() / 1000);
  const fresh = (t: unknown) => typeof t === "number" && t <= now + 60 && now - t <= FRESH_SECONDS;
  if (!fresh(payload.iat)) return false;
  const amr = Array.isArray(payload.amr) ? payload.amr : [];
  const times = amr.flatMap((entry: unknown) =>
    typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).timestamp === "number"
      ? [(entry as Record<string, number>).timestamp]
      : [],
  );
  return times.length > 0 && fresh(Math.max(...times));
}

/** All file paths below `${userId}/` in one bucket (folders are listed with id null). */
async function listUserFiles(service: SupabaseClient, bucket: string, userId: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  const folders = [userId];
  while (folders.length > 0 && files.length < limit) {
    const folder = folders.pop() as string;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await service.storage.from(bucket).list(folder, { limit: LIST_PAGE, offset });
      if (error) throw new Error("storage_list_failed");
      for (const entry of data) {
        const path = `${folder}/${entry.name}`;
        if (entry.id === null) folders.push(path);
        else files.push(path);
      }
      if (data.length < LIST_PAGE || files.length >= limit) break;
    }
  }
  return files.slice(0, limit);
}

/** Deletes the user's files in every bucket. Returns false if more files are left. */
async function deleteUserFiles(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data: buckets, error } = await service.storage.listBuckets();
  if (error) throw new Error("storage_list_failed");
  let budget = MAX_FILES_PER_CALL;
  for (const bucket of buckets) {
    const files = await listUserFiles(service, bucket.id, userId, budget);
    for (let i = 0; i < files.length; i += REMOVE_BATCH) {
      const { error: removeError } = await service.storage.from(bucket.id).remove(files.slice(i, i + REMOVE_BATCH));
      if (removeError) throw new Error("storage_remove_failed");
    }
    budget -= files.length;
    if (budget <= 0) return false;
  }
  return true;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
  const token = authorization.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "server_not_configured" });

  // 1) The caller, verified by Supabase Auth. Everything the caller does goes through their
  //    own session, so the database checks rights exactly as for the app.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || userData.user === null) return json(401, { error: "unauthorized" });
  const callerId = userData.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, { error: "invalid_body" });
  const input = body as Record<string, unknown>;

  let targetId: string;
  let initiatedBy: "self" | "admin";
  if (input.target_user_id === undefined) {
    // (a) Self-deletion: always the caller's own account.
    const payload = jwtPayload(token);
    if (payload === null || !isFreshSignIn(payload)) return json(401, { error: "reauth_required" });
    const { error } = await caller.rpc("request_account_deletion");
    if (error) {
      return error.message === "deletion_not_allowed"
        ? json(409, { error: "deletion_not_allowed" })
        : json(500, { error: "request_failed" });
    }
    targetId = callerId;
    initiatedBy = "self";
  } else {
    // (b) Admin deletion.
    const target = input.target_user_id;
    const username = input.username;
    const reason = input.reason;
    if (typeof target !== "string" || !UUID.test(target)) return json(400, { error: "invalid_target" });
    if (typeof username !== "string" || username.length === 0 || username.length > 40) return json(400, { error: "invalid_username" });
    if (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 500) return json(400, { error: "invalid_reason" });
    const { error } = await caller.rpc("admin_request_account_deletion", {
      p_user_id: target,
      p_username: username,
      p_reason: reason,
    });
    if (error) {
      const known = ["not_authorized", "cannot_delete_self", "cannot_delete_staff", "username_mismatch", "not_found"];
      return known.includes(error.message) ? json(403, { error: error.message }) : json(500, { error: "request_failed" });
    }
    targetId = target;
    initiatedBy = "admin";
  }

  // 2-4) With the service role, only for storage and the Auth admin API.
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const done = await deleteUserFiles(service, targetId);
    if (!done) return json(202, { status: "partial" });

    const { error: finishError } = await service.rpc("finish_account_deletion", {
      p_user_id: targetId,
      p_initiated_by: initiatedBy,
      p_admin_id: initiatedBy === "admin" ? callerId : null,
    });
    if (finishError) throw new Error("finish_failed");

    const { error: deleteError } = await service.auth.admin.deleteUser(targetId);
    // Already gone (a retry after the user was deleted): that's the goal.
    if (deleteError && deleteError.status !== 404) throw new Error("auth_delete_failed");
  } catch (stepError) {
    // Status stays 'deleting'; the app offers "Erneut versuchen". No user data in the log.
    console.error("[delete_account] step failed:", stepError instanceof Error ? stepError.message : "unknown");
    return json(500, { error: "incomplete" });
  }
  return json(200, { status: "deleted" });
});
