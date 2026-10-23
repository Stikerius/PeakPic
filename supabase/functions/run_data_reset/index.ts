// Supabase Edge Function: runs one batch of a confirmed data reset job ("App-Neustart").
//
// Body: {job_id}. The dashboard calls it again and again until the answer says the job is no
// longer "running". Each call works on at most 25 people (batch_size in reset_limits()).
//
// Security
//  * The caller's JWT is checked first (Supabase Auth), then is_admin() (role admin + aal2).
//    Every database step runs with the CALLER's session through the admin_reset_* functions,
//    which check again that the caller is an admin and the creator of the job, that the job is
//    confirmed or running, and skip people who became protected in the meantime.
//  * The service_role key (SUPABASE_SERVICE_ROLE_KEY, provided by Supabase) is used only for
//    what the caller's session can't do: removing files in storage, finish_account_deletion()
//    and deleting auth users (whole accounts), exactly as delete_account does.
//  * Files are removed only in the person's own folder, and only the paths the database
//    returned (checked again here). Nothing about people is logged or returned, only counts.
//
// Resumable: every person has its own state in reset_job_targets ('pending' -> 'claimed' ->
// 'files_pending' -> 'done' | 'failed' | 'skipped'); every step can be repeated. After an
// interruption the same job is simply started again ("Fortsetzen").
//
// Deploy: npx supabase functions deploy run_data_reset
// Secret (optional): ADMIN_ORIGIN=http://127.0.0.1:5174 (where the dashboard runs)

import { createClient } from "npm:@supabase/supabase-js@2";

import { corsHeaders, json } from "../_shared/http.ts";
import { filesForUser, isUuid, resetErrorCode } from "../_shared/resetPaths.ts";
import { deleteUserFiles, removePaths } from "../_shared/storage.ts";

const PHOTO_BUCKET = "photos";

type Claimed = { target_id: string; user_id: string | null; status: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

  // 1) The caller: verified by Supabase Auth, then admin with two-factor (database).
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || userData.user === null) return json(401, { error: "unauthorized" });
  const callerId = userData.user.id;
  const { data: isAdmin, error: adminError } = await caller.rpc("is_admin");
  if (adminError || isAdmin !== true) return json(403, { error: "forbidden" });

  // 2) Input.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const jobId = record(body).job_id;
  if (!isUuid(jobId)) return json(400, { error: "invalid_job" });

  // 3) Start or continue (confirmed / running / failed), one job at a time.
  const { data: started, error: startError } = await caller.rpc("admin_reset_run_start", { p_job_id: jobId });
  if (startError) return json(409, { error: resetErrorCode(startError.message) });
  const mode = record(started).mode;
  if (mode !== "categories" && mode !== "full") return json(500, { error: "failed" });

  const { data: claimed, error: claimError } = await caller.rpc("admin_reset_claim_batch", { p_job_id: jobId });
  if (claimError) return json(409, { error: resetErrorCode(claimError.message) });

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let processed = 0;
  let failed = 0;

  for (const target of (claimed ?? []) as Claimed[]) {
    const ids = { p_job_id: jobId, p_target_id: target.target_id };
    try {
      if (mode === "categories") {
        // Rows first (in the database, with the caller's session), then the files they used.
        const { data, error } = await caller.rpc("admin_reset_apply_user", ids);
        if (error) throw new Error("apply_failed");
        const step = record(data);
        if (step.skipped === true) continue;
        await removePaths(service, PHOTO_BUCKET, filesForUser(String(step.user_id), step.files));
      } else {
        // Whole account: same steps as delete_account (status 'deleting', files, log
        // pseudonymised, auth user deleted; the rows go with it).
        const { data, error } = await caller.rpc("admin_reset_full_prepare", ids);
        if (error) throw new Error("prepare_failed");
        const step = record(data);
        if (step.skipped === true) continue;
        if (step.deleted !== true) {
          const userId = step.user_id;
          if (!isUuid(userId)) throw new Error("prepare_failed");
          // More files than one call removes: the person stays open and comes again next batch.
          if (!(await deleteUserFiles(service, userId))) continue;
          const { error: finishError } = await service.rpc("finish_account_deletion", {
            p_user_id: userId,
            p_initiated_by: "admin",
            p_admin_id: callerId,
          });
          if (finishError) throw new Error("finish_failed");
          const { error: deleteError } = await service.auth.admin.deleteUser(userId);
          // Already gone (a retry after the user was deleted): that's the goal.
          if (deleteError && deleteError.status !== 404) throw new Error("auth_delete_failed");
        }
      }
      const { error: doneError } = await caller.rpc("admin_reset_target_done", ids);
      if (doneError) throw new Error("done_failed");
      processed += 1;
    } catch (stepError) {
      failed += 1;
      const code = stepError instanceof Error ? stepError.message : "step_failed";
      await caller.rpc("admin_reset_target_failed", { ...ids, p_error: code });
      // Error code only, never ids or names.
      console.error("[run_data_reset] step failed:", code);
    }
  }

  // 4) Done when nobody is open any more ('done', or 'failed' if someone failed).
  const { data: progress, error: finishError } = await caller.rpc("admin_reset_run_finish", { p_job_id: jobId });
  if (finishError) return json(500, { error: "failed" });
  return json(200, { ...record(progress), processed, failed_in_batch: failed });
});
