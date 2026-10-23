// Supabase Edge Function: runs a confirmed data reset job ("App-Neustart") and sends the
// notification mails.
//
// Body:
//  * {job_id}                          one batch of at most 25 chosen people (batch_size in
//                                      reset_limits()); the dashboard calls again until the
//                                      answer is no longer "running". When the job is finished,
//                                      the same call sends the notification mails.
//  * {job_id, action: "send_mails"}    "Offene Mails senden": mails still waiting (quota).
//  * {action: "mail_status"}           whether a mail provider is set up (no addresses).
//
// Security
//  * The caller's JWT is checked first (Supabase Auth), then is_admin() (role admin + aal2).
//    Every database step runs with the CALLER's session through the admin_reset_* functions,
//    which check again that the caller is an admin and the creator of the job, that the job is
//    confirmed or running, and skip people who became protected in the meantime.
//  * The service_role key (SUPABASE_SERVICE_ROLE_KEY, provided by Supabase) is used only for
//    what the caller's session can't do: removing files in storage, finish_account_deletion(),
//    deleting auth users (whole accounts, as delete_account does) and the mail queue
//    (reset_mail_*: the addresses never reach the admin's session or the browser).
//  * Files are removed only in the person's own folder, and only the paths the database
//    returned (checked again here). Nothing about people is logged or returned, only counts.
//  * Mails: only to people of whom something was actually removed; the address was read on the
//    server right before (before deleting an account) and is deleted when the mail is out, after
//    7 days at the latest. No links, no tracking. A reached quota stops sending; the rest waits.
//
// Resumable: every person has its own state in reset_job_targets ('pending' -> 'claimed' ->
// 'files_pending' -> 'done' | 'failed' | 'skipped'); every step can be repeated. After an
// interruption the same job is simply started again ("Fortsetzen").
//
// Deploy:  npx supabase functions deploy run_data_reset --use-api
// Secrets: EMAIL_API_KEY, EMAIL_FROM, SUPPORT_EMAIL (see _shared/mail.ts); optional ADMIN_ORIGIN

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { corsHeaders, json } from "../_shared/http.ts";
import { Mailer, mailerFromEnv } from "../_shared/mail.ts";
import { MAIL_FAILURE_TEXTS, stopsBatch, type MailFailure } from "../_shared/mailErrors.ts";
import { filesForUser, isUuid, resetErrorCode } from "../_shared/resetPaths.ts";
import { buildResetMail, textToHtml } from "../_shared/resetMail.ts";
import { deleteUserFiles, removePaths } from "../_shared/storage.ts";

const PHOTO_BUCKET = "photos";
// Per call: mails sent at most, and time spent on them (Edge Functions have a time limit).
const MAILS_PER_CALL = 60;
const MAIL_TIME_BUDGET_MS = 90_000;

type Claimed = { target_id: string; user_id: string | null; status: string };
type QueuedMail = {
  target_id: string;
  email: string;
  role: "selected" | "collateral";
  mode: "categories" | "full";
  categories: string[];
  reason: string;
  subject: string | null;
  user_message: string | null;
};
type MailRun = { sent: number; failed: number; stopped: MailFailure | null; configured: boolean };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Sends the waiting notification mails of a finished job (or marks them "not configured"). */
async function sendResetMails(service: SupabaseClient, mailer: Mailer | null, jobId: string): Promise<MailRun> {
  if (mailer === null) {
    await service.rpc("reset_mail_not_configured", { p_job_id: jobId });
    return { sent: 0, failed: 0, stopped: null, configured: false };
  }
  const started = Date.now();
  const run: MailRun = { sent: 0, failed: 0, stopped: null, configured: true };
  while (run.sent + run.failed < MAILS_PER_CALL && Date.now() - started < MAIL_TIME_BUDGET_MS) {
    const { data, error } = await service.rpc("reset_mail_claim", { p_job_id: jobId, p_limit: 20 });
    if (error) throw new Error("mail_claim_failed");
    const queue = (data ?? []) as QueuedMail[];
    if (queue.length === 0) break;
    for (const item of queue) {
      const mail = buildResetMail({
        role: item.role,
        mode: item.mode,
        categories: item.categories,
        reason: item.reason,
        subject: item.subject,
        userMessage: item.user_message,
        supportEmail: mailer.supportEmail,
      });
      const result = await mailer.send(item.email, mail.subject, mail.text, textToHtml(mail.text), undefined, undefined, {
        idempotencyKey: `reset-${item.target_id}`,
      });
      if (result.ok) {
        run.sent += 1;
        await service.rpc("reset_mail_result", { p_target_id: item.target_id, p_status: "sent" });
      } else if (!stopsBatch(result.failure)) {
        run.failed += 1;
        await service.rpc("reset_mail_result", { p_target_id: item.target_id, p_status: "failed" });
      } else {
        // Quota, rate limit, provider down or misconfigured: the rest stays queued.
        run.stopped = result.failure;
        return run;
      }
    }
  }
  return run;
}

function mailAnswer(run: MailRun): Record<string, unknown> {
  return {
    mail: {
      configured: run.configured,
      sent: run.sent,
      failed: run.failed,
      stopped: run.stopped,
      message: run.stopped !== null ? MAIL_FAILURE_TEXTS[run.stopped] : null,
    },
  };
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
  const input = record(body);
  const { mailer, reason: mailReason } = mailerFromEnv();
  if (input.action === "mail_status") return json(200, { configured: mailer !== null, reason: mailReason });

  const jobId = input.job_id;
  if (!isUuid(jobId)) return json(400, { error: "invalid_job" });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (input.action === "send_mails") {
    // Any admin may send what waits; the job must exist and be finished (checked by the database).
    const { data: status, error: statusError } = await caller.rpc("admin_reset_job_status", { p_job_id: jobId });
    if (statusError) return json(409, { error: resetErrorCode(statusError.message) });
    const state = record(status).status;
    if (state !== "done" && state !== "failed") return json(409, { error: "job_wrong_state" });
    try {
      return json(200, mailAnswer(await sendResetMails(service, mailer, jobId)));
    } catch {
      return json(500, { error: "failed" });
    }
  }

  // 3) Start or continue (confirmed / running / failed), one job at a time.
  const { data: started, error: startError } = await caller.rpc("admin_reset_run_start", { p_job_id: jobId });
  if (startError) return json(409, { error: resetErrorCode(startError.message) });
  const mode = record(started).mode;
  if (mode !== "categories" && mode !== "full") return json(500, { error: "failed" });

  const { data: claimed, error: claimError } = await caller.rpc("admin_reset_claim_batch", { p_job_id: jobId });
  if (claimError) return json(409, { error: resetErrorCode(claimError.message) });

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
        // Whole account: chats ended and the address read (database), then the same steps as
        // delete_account (files, log pseudonymised, auth user deleted; the rows go with it).
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

  // 4) Done when nobody is open any more ('done', or 'failed' if someone failed). Then the
  //    notifications: in-app notices are written by the database, the mails here.
  const { data: progress, error: finishError } = await caller.rpc("admin_reset_run_finish", { p_job_id: jobId });
  if (finishError) return json(500, { error: "failed" });
  const answer: Record<string, unknown> = { ...record(progress), processed, failed_in_batch: failed };
  if (answer.status === "running") return json(200, answer);
  try {
    return json(200, { ...answer, ...mailAnswer(await sendResetMails(service, mailer, jobId)) });
  } catch {
    // The reset is complete; the mails wait for "Offene Mails senden".
    return json(200, { ...answer, mail: { configured: mailer !== null, sent: 0, failed: 0, stopped: "unavailable", message: MAIL_FAILURE_TEXTS.unavailable } });
  }
});
