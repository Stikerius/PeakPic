// Supabase Edge Function: e-mail reminder about changed legal texts.
//
// Security
//  * The caller's JWT is checked first: only admins with a two-factor session (is_admin()
//    checks the role table and aal2). Everything the admin does is logged by the database.
//  * The service_role key (provided by Supabase as SUPABASE_SERVICE_ROLE_KEY) is used ONLY to
//    read e-mail addresses inside this function. Addresses are never returned or logged.
//  * At most 50 recipients per call; only users who are active and still missing the version.
//  * Provider key and sender come from the secrets EMAIL_API_KEY and EMAIL_FROM (never in the
//    repository). Without them the function reports "not configured".
//  * The mail is neutral and contains no links (no login links, no tokens).
//
// Deploy:  npx supabase functions deploy send_legal_notice_email
// Secrets: npx supabase secrets set EMAIL_API_KEY=... EMAIL_FROM="PeakPic <noreply@your-domain>"
//          optional ADMIN_ORIGIN=http://127.0.0.1:5174 (where the dashboard runs)

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_RECIPIENTS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUBJECT = "PeakPic: Rechtstexte aktualisiert";
const TEXT =
  "Hallo,\n\n" +
  "unsere Nutzungsbedingungen oder Datenschutzerklärung haben sich geändert. " +
  "Bitte öffne die App und bestätige die neue Version.\n\n" +
  "Dein PeakPic-Team";

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

/** Sends one mail through the provider's HTTP API (Resend by default, see admin-web/README.md). */
async function sendMail(apiKey: string, from: string, to: string): Promise<boolean> {
  const url = Deno.env.get("EMAIL_API_URL") ?? "https://api.resend.com/emails";
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: SUBJECT, text: TEXT }),
  });
  return response.ok;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) return json(401, { error: "unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "server_not_configured" });

  // 1) The caller: their own session, checked by the database (role + aal2).
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminError } = await caller.rpc("is_admin");
  if (adminError || isAdmin !== true) return json(403, { error: "forbidden" });

  const apiKey = Deno.env.get("EMAIL_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const configured = Boolean(apiKey && from);

  // 2) Input.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (typeof body !== "object" || body === null) return json(400, { error: "invalid_body" });
  const input = body as Record<string, unknown>;
  if (input.action === "status") return json(200, { configured });
  if (!configured) return json(503, { error: "email_not_configured", configured: false });

  const documentId = input.document_id;
  const userIds = input.user_ids;
  if (typeof documentId !== "string" || !UUID.test(documentId)) return json(400, { error: "invalid_document" });
  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > MAX_RECIPIENTS) {
    return json(400, { error: "invalid_recipients", max: MAX_RECIPIENTS });
  }
  const ids = [...new Set(userIds)].filter((id): id is string => typeof id === "string" && UUID.test(id));
  if (ids.length !== userIds.length) return json(400, { error: "invalid_recipients" });

  // 3) Only active users still missing this version (decided by the database).
  const { data: targets, error: targetError } = await caller.rpc("admin_legal_email_targets", {
    p_user_ids: ids,
    p_document_id: documentId,
  });
  if (targetError) return json(400, { error: "invalid_selection" });

  // 4) Addresses only here, with the service role; then send and log each mail (as the admin).
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let sent = 0;
  let failed = 0;
  for (const row of (targets ?? []) as { user_id: string }[]) {
    const { data: user, error: userError } = await service.auth.admin.getUserById(row.user_id);
    const address = user?.user?.email;
    if (userError || !address) {
      failed += 1;
      continue;
    }
    const ok = await sendMail(apiKey as string, from as string, address).catch(() => false);
    if (!ok) {
      failed += 1;
      continue;
    }
    const { error: logError } = await caller.rpc("admin_legal_followup", {
      p_user_id: row.user_id,
      p_document_id: documentId,
      p_action: "email",
      p_note: null,
    });
    if (logError) failed += 1;
    else sent += 1;
  }
  const skipped = ids.length - ((targets ?? []) as unknown[]).length;
  return json(200, { sent, failed, skipped });
});
