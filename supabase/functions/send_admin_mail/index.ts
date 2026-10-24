// Supabase Edge Function: e-mail notices from the dashboard ("Mitteilungen").
//
// Body (always POST):
//  * {action: "status"}                       whether a mail provider is set up, and the limits
//  * {action: "test", category, subject, body, attachments: [path]}
//                                             test mail to the caller's own address; recorded so
//                                             the same content may be sent to others afterwards
//  * {action: "send", category, subject, body, attachments, audience, user_ids, confirm_count,
//     service_only, template_id}              creates the campaign (database checks everything)
//                                             and sends as much as fits into this call
//  * {action: "continue", campaign_id}        sends more of a campaign that is still open
//  * {action: "send_pending"}                 "Rest senden": every open campaign, single messages
//                                             first (e.g. after the daily quota was reached)
// Answer for the sending actions: {campaigns: [{id, status, sent, failed, pending, skipped}],
// more, stopped, message}. Never addresses.
//
// Security
//  * The caller's JWT is checked first (Supabase Auth), then is_admin() (role admin + aal2, not
//    moderators). Campaigns are created and resumed with the CALLER's session through the
//    admin_mail_* functions, which check again, validate the input, resolve and limit the
//    recipients (active accounts only, at most 500) and log every campaign without addresses.
//  * The service_role key (SUPABASE_SERVICE_ROLE_KEY, provided by Supabase) is used only for the
//    queue (mail_claim reads the addresses at the moment of sending; they are never stored,
//    returned or logged), for recording the test mail and for the attachments bucket.
//  * Attachments: only from the admin's own folder in the private bucket mail-attachments; the
//    type is decided by the first bytes (pdf, png, jpg, text), names are rebuilt, at most 3 files
//    and 5 MB together. They are not scanned for malware (the dashboard says so). Deleted when the
//    campaign is done, at the latest after 24 hours (mail_purge, at every call).
//  * Plain text only, escaped into simple HTML; no links added, no tracking pixels. Sender
//    EMAIL_FROM, replies to SUPPORT_EMAIL, the footer says why the mail comes.
//
// Deploy:  npx supabase functions deploy send_admin_mail --use-api
// Secrets: EMAIL_API_KEY, EMAIL_FROM, SUPPORT_EMAIL (already set, see _shared/mail.ts); optional ADMIN_ORIGIN

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { ADMIN_MAIL_LIMITS, buildAdminMail, checkMailContent, testSubject } from "../_shared/adminMail.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { BATCH_MAX, type MailAttachment, type Mailer, mailerFromEnv } from "../_shared/mail.ts";
import { attachmentPathAllowed, detectFileType, sanitizeFilename, toBase64 } from "../_shared/mailAttachments.ts";
import { MAIL_FAILURE_TEXTS, type MailFailure, stopsBatch } from "../_shared/mailErrors.ts";
import { isUuid } from "../_shared/resetPaths.ts";
import { textToHtml } from "../_shared/resetMail.ts";
import { removePaths } from "../_shared/storage.ts";

const BUCKET = "mail-attachments";
// Edge Functions have a time limit; the dashboard calls "continue" until nothing is left.
const TIME_BUDGET_MS = 90_000;
const SINGLE_CLAIM = 20;

type AttachmentMeta = { path: string; name: string; size: number; type: string };
type Loaded = { meta: AttachmentMeta[]; files: MailAttachment[] } | { error: string };
type Stop = MailFailure | "not_configured";
type CampaignRun = { id: string; status: string; sent: number; failed: number; pending: number; skipped: number; stopped: Stop | null };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function count(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

/** Database error to a short code for the dashboard (never details). */
function errorCode(message: string): string {
  return /^[a-z_]{1,40}$/.test(message) ? message : "failed";
}

/** Loads and checks attachments of `owner`'s folder (type from the bytes, sizes, names). */
async function loadAttachments(service: SupabaseClient, owner: string, paths: unknown): Promise<Loaded> {
  if (paths === undefined || paths === null) return { meta: [], files: [] };
  if (!Array.isArray(paths)) return { error: "invalid_attachments" };
  if (paths.length > ADMIN_MAIL_LIMITS.maxFiles) return { error: "too_many_attachments" };
  const meta: AttachmentMeta[] = [];
  const files: MailAttachment[] = [];
  let total = 0;
  for (const path of paths) {
    if (!attachmentPathAllowed(path, owner)) return { error: "invalid_attachments" };
    const { data, error } = await service.storage.from(BUCKET).download(path);
    if (error || data === null) return { error: "attachment_missing" };
    const bytes = new Uint8Array(await data.arrayBuffer());
    total += bytes.length;
    if (total > ADMIN_MAIL_LIMITS.maxTotalBytes) return { error: "attachments_too_large" };
    const kind = detectFileType(bytes);
    if (kind === null) return { error: "attachment_type_not_allowed" };
    const name = sanitizeFilename(path.split("/")[2] ?? "", kind.ext);
    meta.push({ path, name, size: bytes.length, type: kind.type });
    files.push({ filename: name, content: toBase64(bytes), contentType: kind.type });
  }
  return { meta, files };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Records the outcome and returns the campaign's counts; removes its files once it is done. */
async function finish(service: SupabaseClient, id: string, stop: Stop | null, fail: string | null): Promise<CampaignRun> {
  const { data, error } = await service.rpc("mail_campaign_refresh", { p_campaign: id, p_stop: stop, p_fail: fail });
  if (error) throw new Error("refresh_failed");
  const r = record(data);
  const files = (Array.isArray(r.files) ? r.files : []).filter((f): f is string => typeof f === "string");
  if (files.length > 0) {
    // What fails here is removed by mail_purge at a later call.
    await removePaths(service, BUCKET, files).catch(() => console.error("[send_admin_mail] remove failed"));
  }
  return {
    id,
    status: String(r.status),
    sent: count(r.sent),
    failed: count(r.failed),
    pending: count(r.pending),
    skipped: count(r.skipped),
    stopped: stop,
  };
}

/** Sends what is open of one campaign until done, stopped (quota, provider) or out of time. */
async function processCampaign(service: SupabaseClient, mailer: Mailer | null, id: string, deadline: number): Promise<CampaignRun> {
  const { data, error } = await service.rpc("mail_campaign_for_send", { p_campaign: id });
  if (error || data === null) throw new Error("campaign_load_failed");
  const campaign = record(data);
  if (campaign.status === "done") return finish(service, id, null, null);
  if (mailer === null) return finish(service, id, "not_configured", null);
  const checked = checkMailContent(campaign.category, campaign.subject, campaign.body);
  if (!checked.ok) return finish(service, id, null, "text_expired");

  const paths = (Array.isArray(campaign.attachments) ? campaign.attachments : []).map((a) => record(a).path);
  let files: MailAttachment[] = [];
  if (paths.length > 0) {
    const owner = campaign.created_by;
    if (!isUuid(owner)) return finish(service, id, null, "attachment_missing");
    const loaded = await loadAttachments(service, owner, paths);
    if ("error" in loaded) return finish(service, id, null, loaded.error);
    files = loaded.files;
  }
  const mail = buildAdminMail(checked.content, mailer.supportEmail);
  const html = textToHtml(mail.text);

  let stopped: MailFailure | null = null;
  while (stopped === null && Date.now() < deadline) {
    const { data: claimed, error: claimError } = await service.rpc("mail_claim", {
      p_campaign: id,
      p_limit: files.length > 0 ? SINGLE_CLAIM : BATCH_MAX,
    });
    if (claimError) throw new Error("claim_failed");
    const batch = (claimed ?? []) as { recipient_id: string; email: string }[];
    if (batch.length === 0) break;
    const sent: string[] = [];
    const failed: string[] = [];
    const back: string[] = [];
    let singles = batch;
    if (files.length === 0 && batch.length > 1) {
      const ids = batch.map((r) => r.recipient_id);
      const result = await mailer.sendBatch(
        batch.map((r) => ({ to: r.email, subject: mail.subject, text: mail.text, html })),
        `mail-${id}-${await sha256Hex(ids.join(","))}`,
      );
      if (result.ok) {
        sent.push(...ids);
        singles = [];
      } else if (stopsBatch(result.failure)) {
        stopped = result.failure;
        back.push(...ids);
        singles = [];
      }
      // "rejected" (e.g. one invalid address): the same people one by one below.
    }
    for (const r of singles) {
      if (stopped !== null || Date.now() >= deadline) {
        back.push(r.recipient_id);
        continue;
      }
      const result = await mailer.send(r.email, mail.subject, mail.text, html, files.length > 0 ? files : undefined, undefined, {
        idempotencyKey: `mail-${r.recipient_id}`,
      });
      if (result.ok) sent.push(r.recipient_id);
      else if (!stopsBatch(result.failure)) failed.push(r.recipient_id);
      else {
        stopped = result.failure;
        back.push(r.recipient_id);
      }
    }
    for (const [ids, status, code] of [[sent, "sent", null], [failed, "failed", "rejected"], [back, "pending", null]] as const) {
      if (ids.length === 0) continue;
      const { error: resultError } = await service.rpc("mail_result", { p_recipient_ids: ids, p_status: status, p_error: code });
      if (resultError) throw new Error("result_failed");
    }
  }
  return finish(service, id, stopped, null);
}

/** Sends the given campaigns in order until time runs out or the provider stops everything. */
async function processAll(service: SupabaseClient, mailer: Mailer | null, ids: string[], deadline: number) {
  const campaigns: CampaignRun[] = [];
  let stopped: Stop | null = null;
  for (const id of ids) {
    if (stopped !== null || Date.now() >= deadline) break;
    const run = await processCampaign(service, mailer, id, deadline);
    campaigns.push(run);
    stopped = run.stopped;
  }
  const more = campaigns.some((c) => c.status === "sending") || (stopped === null && campaigns.length < ids.length);
  const message =
    stopped === null
      ? null
      : stopped === "not_configured"
        ? "Kein Mail-Dienst eingerichtet. Die Mails warten."
        : MAIL_FAILURE_TEXTS[stopped];
  return { campaigns, more, stopped, message };
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
    return json(400, { error: "invalid_json" });
  }
  const input = record(body);
  const { mailer, reason } = mailerFromEnv();
  if (input.action === "status") return json(200, { configured: mailer !== null, reason, limits: ADMIN_MAIL_LIMITS });

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Clean-up first: attachments after 24 hours, texts after keep_days, unused uploads.
  try {
    const { data: stale } = await service.rpc("mail_purge");
    const paths = (Array.isArray(stale) ? stale : []).filter((p): p is string => typeof p === "string");
    if (paths.length > 0) await removePaths(service, BUCKET, paths);
  } catch {
    console.error("[send_admin_mail] purge failed");
  }
  const deadline = Date.now() + TIME_BUDGET_MS;

  try {
    if (input.action === "test" || input.action === "send") {
      if (mailer === null) return json(503, { error: "email_not_configured", reason });
      const checked = checkMailContent(input.category, input.subject, input.body);
      if (!checked.ok) return json(400, { error: checked.error });
      const loaded = await loadAttachments(service, callerId, input.attachments);
      if ("error" in loaded) return json(400, { error: loaded.error });

      if (input.action === "test") {
        const own = userData.user.email;
        if (!own) return json(400, { error: "no_own_address" });
        const mail = buildAdminMail(checked.content, mailer.supportEmail);
        const result = await mailer.send(own, testSubject(mail.subject), mail.text, textToHtml(mail.text), loaded.files.length > 0 ? loaded.files : undefined);
        if (!result.ok) return json(502, { error: "send_failed", message: MAIL_FAILURE_TEXTS[result.failure] });
        const { error: testError } = await service.rpc("mail_record_test", {
          p_admin: callerId,
          p_category: checked.content.category,
          p_subject: checked.content.subject,
          p_body: checked.content.body,
          p_attachments: loaded.meta,
        });
        if (testError) return json(400, { error: errorCode(testError.message) });
        return json(200, { ok: true, attachments: loaded.meta.map(({ name, size, type }) => ({ name, size, type })) });
      }

      const userIds = input.user_ids ?? [];
      if (!Array.isArray(userIds) || userIds.length > ADMIN_MAIL_LIMITS.maxRecipients || !userIds.every(isUuid)) {
        return json(400, { error: "invalid_recipients" });
      }
      const confirmCount = input.confirm_count ?? null;
      if (confirmCount !== null && !Number.isInteger(confirmCount)) return json(400, { error: "confirm_count_mismatch" });
      const templateId = input.template_id ?? null;
      if (templateId !== null && !isUuid(templateId)) return json(400, { error: "template_not_found" });
      const { data: created, error: createError } = await caller.rpc("admin_mail_create", {
        p_category: checked.content.category,
        p_subject: checked.content.subject,
        p_body: checked.content.body,
        p_audience: input.audience,
        p_user_ids: userIds,
        p_attachments: loaded.meta,
        p_confirm_count: confirmCount,
        p_service_only: input.service_only === true,
        p_template_id: templateId,
      });
      if (createError || typeof created !== "string") return json(400, { error: errorCode(createError?.message ?? "") });
      return json(200, { campaign_id: created, ...(await processAll(service, mailer, [created], deadline)) });
    }

    if (input.action === "continue" || input.action === "send_pending") {
      if (input.action === "continue" && !isUuid(input.campaign_id)) return json(400, { error: "invalid_campaign" });
      const { data: open, error: openError } = await caller.rpc("admin_mail_resume", {
        p_campaign_id: input.action === "continue" ? input.campaign_id : null,
      });
      if (openError) return json(400, { error: errorCode(openError.message) });
      const ids = ((open ?? []) as { campaign_id: string }[]).map((r) => r.campaign_id);
      return json(200, await processAll(service, mailer, ids, deadline));
    }
  } catch (sendError) {
    // Error code only, never addresses or texts.
    console.error("[send_admin_mail] failed:", sendError instanceof Error ? sendError.message : "unknown");
    return json(500, { error: "failed" });
  }
  return json(400, { error: "invalid_action" });
});
