import { asArray, asRecord, bool, isRecord, num, str, strOrNull, type Json } from "./decode";
import { DEFAULT_COLOR_SET, parseColorSet, type ColorSet } from "./brand";
import type { ColorTarget } from "./colorLibrary";
import { toCounts, type Candidate, type Counts, type JobStatus, type ResetMode } from "./reset";
import { SIGNED_URL_SECONDS, supabase } from "./supabase";

/**
 * Wrappers for the staff functions of the database (mod_* / admin_*). The database checks the
 * role and the two-factor session on every call; nothing here grants anything.
 */

export type StaffRole = "moderator" | "admin";
export type ContentType = "post" | "story" | "comment" | "message" | "plan" | "workout";

const ERROR_TEXTS: Record<string, string> = {
  not_authorized: "Keine Berechtigung (Rolle oder Zwei-Faktor fehlt).",
  reason_too_short: "Die Begründung braucht mindestens 10 Zeichen.",
  cannot_target_self: "Das eigene Konto kann nicht moderiert werden.",
  cannot_target_staff: "Moderatoren und Admins können nicht moderiert werden.",
  suspension_too_long: "Moderatoren dürfen höchstens 7 Tage sperren.",
  suspension_in_past: "Das Enddatum liegt in der Vergangenheit.",
  user_not_suspendable: "Dieses Konto kann nicht gesperrt werden.",
  user_not_suspended: "Das Konto ist nicht gesperrt.",
  user_not_found: "Konto nicht gefunden.",
  report_not_found: "Meldung nicht gefunden.",
  target_not_found: "Inhalt nicht gefunden.",
  quarantined_admin_only: "Inhalte in Quarantäne kann nur ein Admin ändern.",
  user_message_required: "Für eine Verwarnung ist eine Nachricht an den Nutzer nötig.",
  invalid_status: "Ungültiger Status.",
  invalid_reason_code: "Ungültiger Sperrgrund.",
  // Data reset
  invalid_mode: "Ungültiger Umfang.",
  no_categories: "Mindestens eine Kategorie wählen.",
  invalid_category: "Unbekannte Kategorie.",
  full_reset_disabled: "Komplettes Löschen ist ausgeschaltet (app_settings.allow_full_reset).",
  job_not_found: "Auftrag nicht gefunden.",
  not_job_owner: "Nur wer den Auftrag erstellt hat, darf ihn ändern, bestätigen oder ausführen.",
  job_wrong_state: "Der Auftrag ist in diesem Zustand nicht mehr änderbar.",
  too_many_targets: "Höchstens 500 Personen pro Auftrag.",
  unknown_user: "Mindestens ein Konto existiert nicht mehr. Bitte die Liste neu laden.",
  protected_target: "Geschützte Konten, Admins, Moderatoren und das eigene Konto sind nicht wählbar.",
  flagged_not_confirmed: "Markierte Konten brauchen die zusätzliche Bestätigung.",
  target_deleting: "Konten im Löschen sind nur bei „Konten komplett löschen“ wählbar.",
  wrong_phrase: "Das Bestätigungswort stimmt nicht.",
  totp_required: "Der Zwei-Faktor-Code ist älter als 5 Minuten. Bitte einen neuen Code eingeben.",
  preview_required: "Zuerst den Trockenlauf mit dem aktuellen Stand ausführen.",
  no_targets: "Niemand ausgewählt.",
  other_job_active: "Ein anderer Auftrag ist bereits bestätigt oder läuft.",
};

export class ApiError extends Error {}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError(ERROR_TEXTS[error.message] ?? `Fehler: ${error.message}`);
  return data;
}

// ------------------------------------------------------------------ session

export async function fetchWhoami(): Promise<{ role: StaffRole | null; hasAal2: boolean }> {
  const row = asRecord(asArray(await rpc("admin_whoami", {}))[0]);
  const role = str(row.role);
  return { role: role === "admin" || role === "moderator" ? role : null, hasAal2: bool(row.has_aal2) };
}

// ------------------------------------------------------------------ reports

export type QueueRow = {
  id: string;
  targetType: string;
  targetId: string;
  targetUserId: string | null;
  targetUsername: string | null;
  reporterUsername: string | null;
  reason: string;
  status: string;
  createdAt: string;
  reportsOnTarget: number;
};

export type QueueFilter = {
  status: string | null;
  targetType: string | null;
  reason: string | null;
  minAgeHours: number | null;
  newestFirst: boolean;
};

export async function fetchQueue(filter: QueueFilter, offset: number): Promise<QueueRow[]> {
  const rows = asArray(
    await rpc("admin_report_queue", {
      p_status: filter.status,
      p_target_type: filter.targetType,
      p_reason: filter.reason,
      p_min_age_hours: filter.minAgeHours,
      p_newest_first: filter.newestFirst,
      p_limit: 50,
      p_offset: offset,
    }),
  );
  return rows.map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      targetType: str(r.target_type),
      targetId: str(r.target_id),
      targetUserId: strOrNull(r.target_user_id),
      targetUsername: strOrNull(r.target_username),
      reporterUsername: strOrNull(r.reporter_username),
      reason: str(r.reason),
      status: str(r.status),
      createdAt: str(r.created_at),
      reportsOnTarget: num(r.reports_on_target),
    };
  });
}

export type ReportDetail = {
  report: Json;
  reporter: Json | null;
  targetUser: Json | null;
  content: Json | null;
  contentHiddenQuarantine: boolean;
  otherReports: number;
};

export async function fetchReportDetail(reportId: string): Promise<ReportDetail> {
  const d = asRecord(await rpc("admin_report_detail", { p_report_id: reportId }));
  return {
    report: asRecord(d.report),
    reporter: isRecord(d.reporter) ? d.reporter : null,
    targetUser: isRecord(d.target_user) ? d.target_user : null,
    content: isRecord(d.content) ? d.content : null,
    contentHiddenQuarantine: bool(d.content_hidden_quarantine),
    otherReports: num(d.other_reports),
  };
}

export function resolveReport(reportId: string, status: "in_review" | "resolved" | "dismissed", note: string) {
  return rpc("mod_resolve_report", { p_report_id: reportId, p_status: status, p_resolution_note: note });
}

// ------------------------------------------------------------------ content and accounts

export function removeContent(type: ContentType, id: string, reason: string, userMessage: string, reportId: string | null) {
  return rpc("mod_remove_content", {
    p_type: type, p_id: id, p_reason: reason, p_user_message: userMessage, p_report_id: reportId,
  });
}

export function quarantineContent(type: ContentType, id: string, reason: string, reportId: string | null) {
  return rpc("mod_quarantine_content", { p_type: type, p_id: id, p_reason: reason, p_report_id: reportId });
}

export function restoreContent(type: ContentType, id: string, reason: string, reportId: string | null) {
  return rpc("mod_restore_content", { p_type: type, p_id: id, p_reason: reason, p_report_id: reportId });
}

export function warnUser(userId: string, reason: string, userMessage: string, reportId: string | null) {
  return rpc("mod_warn_user", { p_user_id: userId, p_reason: reason, p_user_message: userMessage, p_report_id: reportId });
}

export function suspendUser(userId: string, untilIso: string | null, reason: string, userMessage: string, reportId: string | null) {
  return rpc("mod_suspend_user", {
    p_user_id: userId, p_until: untilIso, p_reason: reason, p_user_message: userMessage,
    p_reason_code: "moderation", p_report_id: reportId,
  });
}

export function banUser(userId: string, reason: string, userMessage: string, reportId: string | null) {
  return rpc("mod_ban_user", { p_user_id: userId, p_reason: reason, p_user_message: userMessage, p_report_id: reportId });
}

export function unbanUser(userId: string, reason: string) {
  return rpc("mod_unban_user", { p_user_id: userId, p_reason: reason });
}

export type UserRow = { id: string; username: string; displayName: string; accountStatus: string; createdAt: string };

export async function searchUsers(query: string): Promise<UserRow[]> {
  return asArray(await rpc("admin_search_users", { p_query: query })).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      username: str(r.username),
      displayName: str(r.display_name),
      accountStatus: str(r.account_status),
      createdAt: str(r.created_at),
    };
  });
}

export type UserDetail = { profile: Json; reportsAgainst: Json[]; actions: Json[]; reportsFiled: number };

export async function fetchUserDetail(userId: string): Promise<UserDetail> {
  const d = asRecord(await rpc("admin_user_detail", { p_user_id: userId }));
  return {
    profile: asRecord(d.profile),
    reportsAgainst: asArray(d.reports_against).map(asRecord),
    actions: asArray(d.actions).map(asRecord),
    reportsFiled: num(d.reports_filed),
  };
}

export async function fetchUserEmail(userId: string, reason: string): Promise<string> {
  return str(await rpc("admin_get_user_email", { p_user_id: userId, p_reason: reason }));
}

// ------------------------------------------------------------------ overview and audit log

export type Overview = { openReports: number; inReviewReports: number; oldestOpenAt: string | null; quarantined: number };

export async function fetchOverview(): Promise<Overview> {
  const d = asRecord(await rpc("admin_overview", {}));
  return {
    openReports: num(d.open_reports),
    inReviewReports: num(d.in_review_reports),
    oldestOpenAt: strOrNull(d.oldest_open_at),
    quarantined: num(d.quarantined),
  };
}

export type AuditRow = {
  id: string;
  createdAt: string;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetUserId: string | null;
  reason: string;
  userMessage: string | null;
};

export async function fetchAuditLog(query: string, action: string | null, offset: number): Promise<AuditRow[]> {
  return asArray(
    await rpc("admin_audit_log", {
      p_query: query === "" ? null : query,
      p_action: action,
      p_target_user: null,
      p_limit: 100,
      p_offset: offset,
    }),
  ).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      createdAt: str(r.created_at),
      actorUsername: strOrNull(r.actor_username),
      action: str(r.action),
      targetType: strOrNull(r.target_type),
      targetUserId: strOrNull(r.target_user_id),
      reason: str(r.reason),
      userMessage: strOrNull(r.user_message),
    };
  });
}

// ------------------------------------------------------------------ photos

/** Short-lived signed URL; the storage policy only allows reported or moderated photos. */
export async function signedPhotoUrl(path: string): Promise<string | null> {
  if (path === "") return null;
  const { data, error } = await supabase.storage.from("photos").createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}

// ------------------------------------------------------------------ legal texts (admins)

export type LegalDocType = "terms" | "privacy" | "guidelines";
export type LegalConfirmation = "accept" | "acknowledge";

export type LegalVersionRow = {
  id: string;
  docType: LegalDocType;
  version: number;
  title: string;
  status: "draft" | "published" | "archived";
  confirmationType: LegalConfirmation;
  requiresConfirmation: boolean;
  blocking: boolean;
  graceDays: number;
  changeSummary: string | null;
  publishedAt: string | null;
  announcedAt: string | null;
  createdAt: string;
  contentHash: string | null;
  confirmed: number;
  pending: number;
  overdue: number;
};

function legalType(value: unknown): LegalDocType {
  return value === "privacy" || value === "guidelines" ? value : "terms";
}

function legalStatus(value: unknown): LegalVersionRow["status"] {
  return value === "published" || value === "archived" ? value : "draft";
}

export async function fetchLegalList(): Promise<LegalVersionRow[]> {
  return asArray(await rpc("admin_legal_list", {})).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      docType: legalType(r.doc_type),
      version: num(r.version),
      title: str(r.title),
      status: legalStatus(r.status),
      confirmationType: r.confirmation_type === "accept" ? "accept" : "acknowledge",
      requiresConfirmation: bool(r.requires_confirmation),
      blocking: bool(r.blocking),
      graceDays: num(r.grace_days),
      changeSummary: strOrNull(r.change_summary),
      publishedAt: strOrNull(r.published_at),
      announcedAt: strOrNull(r.announced_at),
      createdAt: str(r.created_at),
      contentHash: strOrNull(r.content_hash),
      confirmed: num(r.confirmed),
      pending: num(r.pending),
      overdue: num(r.overdue),
    };
  });
}

export type LegalDraft = {
  id: string | null;
  docType: LegalDocType;
  title: string;
  bodyMd: string;
  changeSummary: string;
  confirmationType: LegalConfirmation;
  requiresConfirmation: boolean;
  blocking: boolean;
  graceDays: number;
};

export async function fetchLegalDocumentBody(id: string): Promise<{ draft: LegalDraft; status: string; version: number }> {
  const r = asRecord(asArray(await rpc("admin_legal_document", { p_id: id }))[0]);
  return {
    status: str(r.status),
    version: num(r.version),
    draft: {
      id: str(r.id),
      docType: legalType(r.doc_type),
      title: str(r.title),
      bodyMd: str(r.body_md),
      changeSummary: str(r.change_summary),
      confirmationType: r.confirmation_type === "accept" ? "accept" : "acknowledge",
      requiresConfirmation: bool(r.requires_confirmation),
      blocking: bool(r.blocking),
      graceDays: num(r.grace_days),
    },
  };
}

export async function saveLegalDraft(draft: LegalDraft): Promise<string> {
  return str(
    await rpc("admin_legal_save_draft", {
      p_id: draft.id,
      p_doc_type: draft.docType,
      p_title: draft.title,
      p_body_md: draft.bodyMd,
      p_change_summary: draft.changeSummary,
      p_confirmation_type: draft.confirmationType,
      p_requires_confirmation: draft.requiresConfirmation,
      p_blocking: draft.blocking,
      p_grace_days: draft.graceDays,
    }),
  );
}

export function deleteLegalDraft(id: string, reason: string) {
  return rpc("admin_legal_delete_draft", { p_id: id, p_reason: reason });
}

export async function fetchAffectedCount(): Promise<number> {
  return num(await rpc("admin_legal_affected_count", {}));
}

/** Publishes and announces (notices and reminders); returns the number of notified users. */
export async function publishLegalDocument(id: string, reason: string): Promise<number> {
  return num(await rpc("admin_legal_publish", { p_id: id, p_reason: reason }));
}

export type PendingRow = {
  userId: string;
  username: string;
  displayName: string;
  documentId: string;
  docType: LegalDocType;
  version: number;
  announcedAt: string | null;
  daysSinceAnnounce: number;
  actionCount: number;
  lastAction: string | null;
  lastActionAt: string | null;
  dueAt: string | null;
  note: string | null;
};

export async function fetchPendingConfirmations(offset: number): Promise<PendingRow[]> {
  return asArray(await rpc("admin_legal_pending", { p_limit: 100, p_offset: offset })).map((value) => {
    const r = asRecord(value);
    return {
      userId: str(r.user_id),
      username: str(r.username),
      displayName: str(r.display_name),
      documentId: str(r.document_id),
      docType: legalType(r.doc_type),
      version: num(r.version),
      announcedAt: strOrNull(r.announced_at),
      daysSinceAnnounce: num(r.days_since_announce),
      actionCount: num(r.action_count),
      lastAction: strOrNull(r.last_action),
      lastActionAt: strOrNull(r.last_action_at),
      dueAt: strOrNull(r.due_at),
      note: strOrNull(r.note),
    };
  });
}

export function legalFollowup(userId: string, documentId: string, action: "notify" | "defer", note: string | null) {
  return rpc("admin_legal_followup", { p_user_id: userId, p_document_id: documentId, p_action: action, p_note: note });
}

export async function legalBulkNotify(userIds: string[], documentId: string): Promise<number> {
  return num(await rpc("admin_legal_bulk_notify", { p_user_ids: userIds, p_document_id: documentId }));
}

export function legalSuspend(userId: string, documentId: string, reason: string, userMessage: string) {
  return rpc("admin_legal_suspend", { p_user_id: userId, p_document_id: documentId, p_reason: reason, p_user_message: userMessage });
}

export async function fetchLegalOverview(): Promise<{ overdue: number; oldestDueAt: string | null }> {
  const d = asRecord(await rpc("admin_legal_overview", {}));
  return { overdue: num(d.overdue), oldestDueAt: strOrNull(d.oldest_due_at) };
}

export async function fetchLegalUserHistory(userId: string): Promise<{ confirmations: Json[]; followups: Json[] }> {
  const d = asRecord(await rpc("admin_legal_user_history", { p_user_id: userId }));
  return { confirmations: asArray(d.confirmations).map(asRecord), followups: asArray(d.followups).map(asRecord) };
}

// ------------------------------------------------------------------ e-mail (Edge Function)

const EMAIL_FUNCTION = "send_legal_notice_email";

/** Whether the e-mail provider is set up (EMAIL_API_KEY and EMAIL_FROM secrets). */
export async function fetchEmailConfigured(): Promise<{ configured: boolean; reason: string | null }> {
  const { data, error } = await supabase.functions.invoke(EMAIL_FUNCTION, { body: { action: "status" } });
  if (error) return { configured: false, reason: "Edge Function send_legal_notice_email ist nicht erreichbar (nicht deployt?)." };
  const configured = bool(asRecord(data).configured);
  return { configured, reason: configured ? null : "Secrets EMAIL_API_KEY und EMAIL_FROM fehlen in Supabase." };
}

export async function sendLegalEmails(userIds: string[], documentId: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data, error } = await supabase.functions.invoke(EMAIL_FUNCTION, { body: { user_ids: userIds, document_id: documentId } });
  if (error) throw new ApiError("E-Mail-Versand fehlgeschlagen.");
  const d = asRecord(data);
  return { sent: num(d.sent), failed: num(d.failed), skipped: num(d.skipped) };
}

// ------------------------------------------------------------------ account deletion (Edge Function)

const DELETION_ERRORS: Record<string, string> = {
  not_authorized: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  cannot_delete_self: "Das eigene Konto lässt sich hier nicht löschen.",
  cannot_delete_staff: "Moderatoren und Admins lassen sich nicht löschen. Zuerst die Rolle per SQL entfernen.",
  cannot_delete_official: "Das offizielle Konto lässt sich nicht löschen. Zuerst ein anderes Konto als offizielles festlegen (official-account-setup.sql).",
  username_mismatch: "Der Username stimmt nicht.",
  not_found: "Konto nicht gefunden.",
  invalid_reason: "Begründung: mindestens 10 Zeichen.",
  incomplete: "Löschung nicht abgeschlossen. Das Konto ist bereits unsichtbar; bitte erneut versuchen.",
};

/**
 * Deletes an account for good (files, auth user, all rows). The Edge Function checks admin role
 * and two-factor in the database, logs the action and refuses the own account and staff.
 */
export async function deleteAccountAsAdmin(userId: string, username: string, reason: string): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    const { data, error } = await supabase.functions.invoke("delete_account", {
      body: { target_user_id: userId, username, reason },
    });
    if (error) {
      const context: unknown = (error as { context?: unknown }).context;
      let code = "";
      if (context instanceof Response) {
        try {
          code = str(asRecord(await context.json()).error);
        } catch {
          code = "";
        }
      }
      throw new ApiError(DELETION_ERRORS[code] ?? "Löschung fehlgeschlagen. Ist die Edge Function delete_account deployt?");
    }
    const status = asRecord(data).status;
    if (status === "deleted") return;
    if (status !== "partial") break;
  }
  throw new ApiError(DELETION_ERRORS.incomplete);
}

// ------------------------------------------------------------------ usage statistics (admins)

export type StatsBucket = "day" | "week" | "month" | "year";
export type StatsMetric =
  | "accounts"
  | "active_accounts"
  | "posts"
  | "stories"
  | "highlights"
  | "comments"
  | "messages"
  | "likes"
  | "follows"
  | "reports"
  | "workouts"
  | "plans"
  | "plans_adopted"
  | "deleted_accounts";

export type StatsOverview = {
  accounts: { total: number; active: number; suspended: number; banned: number; deleting: number };
  /** Counter totals by event name ("published so far", deleted content included). */
  published: Record<string, number>;
  /** Rows present now. */
  present: Record<string, number>;
};

function numberRecord(value: unknown): Record<string, number> {
  const r = asRecord(value);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
}

export async function fetchStatsOverview(): Promise<StatsOverview> {
  const d = asRecord(await rpc("admin_stats_overview", {}));
  const a = asRecord(d.accounts);
  return {
    accounts: { total: num(a.total), active: num(a.active), suspended: num(a.suspended), banned: num(a.banned), deleting: num(a.deleting) },
    published: numberRecord(d.published),
    present: numberRecord(d.present),
  };
}

export type SeriesPoint = { bucket: string; value: number };

export async function fetchStatsSeries(metric: StatsMetric, from: string, to: string, bucket: StatsBucket): Promise<SeriesPoint[]> {
  return asArray(await rpc("admin_stats_timeseries", { p_metric: metric, p_from: from, p_to: to, p_bucket: bucket })).map((value) => {
    const r = asRecord(value);
    return { bucket: str(r.bucket), value: num(r.value) };
  });
}

export type PeriodRow = { metric: string; current: number; previous: number };

export async function fetchStatsPeriod(from: string, to: string): Promise<PeriodRow[]> {
  return asArray(await rpc("admin_stats_period", { p_from: from, p_to: to })).map((value) => {
    const r = asRecord(value);
    return { metric: str(r.metric), current: num(r.current_value), previous: num(r.previous_value) };
  });
}

export type AreaRow = { area: string; event: string; total: number };

export async function fetchStatsAreas(from: string, to: string): Promise<AreaRow[]> {
  return asArray(await rpc("admin_stats_areas", { p_from: from, p_to: to })).map((value) => {
    const r = asRecord(value);
    return { area: str(r.area), event: str(r.event), total: num(r.total) };
  });
}

export async function fetchStatsFirstDay(): Promise<string | null> {
  return strOrNull(await rpc("admin_stats_first_day", {}));
}

// ------------------------------------------------------------------ data reset (admins)

export type ResetSettings = { allowFullReset: boolean; maxTargets: number; batchSize: number };

export async function fetchResetSettings(): Promise<ResetSettings> {
  const r = asRecord(await rpc("admin_reset_settings", {}));
  return { allowFullReset: bool(r.allow_full_reset), maxTargets: num(r.max_targets), batchSize: num(r.batch_size) };
}

export async function fetchResetCandidates(query: string): Promise<Candidate[]> {
  return asArray(await rpc("admin_reset_candidates", { p_query: query.trim() === "" ? null : query.trim() })).map((value) => {
    const r = asRecord(value);
    return {
      userId: str(r.user_id),
      username: str(r.username),
      displayName: str(r.display_name),
      accountStatus: str(r.account_status),
      createdAt: str(r.created_at),
      protection: strOrNull(r.protection),
      flags: asArray(r.flags).map(str).filter((f) => f !== ""),
    };
  });
}

export type ResetJobDraft = {
  mode: ResetMode;
  categories: string[];
  reason: string;
  subject: string;
  userMessage: string;
};

function draftArgs(draft: ResetJobDraft): Record<string, unknown> {
  return {
    p_mode: draft.mode,
    p_categories: draft.mode === "full" ? null : draft.categories,
    p_reason: draft.reason,
    p_subject: draft.subject,
    p_user_message: draft.userMessage,
  };
}

export async function createResetJob(draft: ResetJobDraft): Promise<string> {
  return str(await rpc("admin_reset_create_job", draftArgs(draft)));
}

export async function updateResetJob(jobId: string, draft: ResetJobDraft): Promise<void> {
  await rpc("admin_reset_update_job", { p_job_id: jobId, ...draftArgs(draft) });
}

export async function setResetTargets(jobId: string, userIds: string[], includeFlagged: boolean): Promise<number> {
  return num(await rpc("admin_reset_set_targets", { p_job_id: jobId, p_user_ids: userIds, p_include_flagged: includeFlagged }));
}

export type ResetPreviewRow = {
  targetId: string;
  userId: string;
  username: string;
  displayName: string;
  flagged: boolean;
  counts: Counts;
  total: number;
};

export type ResetCollateralRow = {
  targetId: string;
  username: string;
  displayName: string;
  counts: Counts;
  protected: boolean;
  hasEmail: boolean;
};

export type ResetPreview = {
  totals: Counts;
  files: number;
  targets: ResetPreviewRow[];
  /** Not chosen, but lose a chat that is ended for everybody. */
  collateral: ResetCollateralRow[];
  /** Chats with a protected account that stay (only the chosen person's side goes). */
  protectedChatsKept: number;
  includeProtectedChats: boolean;
  raw: Json;
};

function collateralRows(value: unknown): ResetCollateralRow[] {
  return asArray(value).map((item) => {
    const r = asRecord(item);
    return {
      targetId: str(r.target_id),
      username: str(r.username),
      displayName: str(r.display_name),
      counts: toCounts(r.counts),
      protected: bool(r.protected),
      hasEmail: bool(r.has_email),
    };
  });
}

/** Dry run: numbers per person and in total; deletes nothing. */
export async function previewResetJob(jobId: string): Promise<ResetPreview> {
  const raw = asRecord(await rpc("admin_reset_preview", { p_job_id: jobId }));
  return {
    totals: toCounts(raw.totals),
    files: num(raw.files),
    targets: asArray(raw.targets).map((value) => {
      const r = asRecord(value);
      return {
        targetId: str(r.target_id),
        userId: str(r.user_id),
        username: str(r.username),
        displayName: str(r.display_name),
        flagged: bool(r.flagged),
        counts: toCounts(r.counts),
        total: num(r.total),
      };
    }),
    collateral: collateralRows(raw.collateral),
    protectedChatsKept: num(raw.protected_chats_kept),
    includeProtectedChats: bool(raw.include_protected_chats),
    raw,
  };
}

/** "Chats mit geschützten Konten ebenfalls beenden" (logged; needs a new dry run). */
export async function setResetProtectedChats(jobId: string, include: boolean): Promise<void> {
  await rpc("admin_reset_set_protected_chats", { p_job_id: jobId, p_include: include });
}

/** Backup of the affected rows (chats without text, no addresses, no files). Logged. */
export async function exportResetJob(jobId: string): Promise<Json> {
  return asRecord(await rpc("admin_reset_export", { p_job_id: jobId }));
}

export async function confirmResetJob(jobId: string, phrase: string): Promise<void> {
  await rpc("admin_reset_confirm", { p_job_id: jobId, p_phrase: phrase });
}

export async function cancelResetJob(jobId: string): Promise<void> {
  await rpc("admin_reset_cancel", { p_job_id: jobId });
}

export type ResetJobRow = {
  id: string;
  status: JobStatus;
  mode: ResetMode;
  categories: string[];
  createdAt: string;
  confirmedAt: string | null;
  finishedAt: string | null;
  targets: number;
  own: boolean;
};

function jobStatus(value: unknown): JobStatus {
  const s = str(value);
  return s === "confirmed" || s === "running" || s === "done" || s === "failed" || s === "cancelled" ? s : "draft";
}

function resetMode(value: unknown): ResetMode {
  return str(value) === "full" ? "full" : "categories";
}

export async function fetchResetJobs(): Promise<ResetJobRow[]> {
  return asArray(await rpc("admin_reset_jobs", {})).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      status: jobStatus(r.status),
      mode: resetMode(r.mode),
      categories: asArray(r.categories).map(str),
      createdAt: str(r.created_at),
      confirmedAt: strOrNull(r.confirmed_at),
      finishedAt: strOrNull(r.finished_at),
      targets: num(r.targets),
      own: bool(r.own),
    };
  });
}

export type ResetTargetRow = {
  targetId: string;
  userId: string | null;
  username: string | null;
  displayName: string | null;
  userHash: string;
  flagged: boolean;
  status: string;
  error: string | null;
  counts: Counts;
  result: Counts;
  emailStatus: string;
  /** In-app notice written (people who keep their account). */
  inApp: boolean;
  role: "selected" | "collateral";
  attempts: number;
};

export type ResetMailSummary = { pending: number; sent: number; failed: number; notConfigured: number; inApp: number };

export type ResetProgress = { total: number; done: number; failed: number; skipped: number; open: number };

export type ResetJob = {
  id: string;
  status: JobStatus;
  mode: ResetMode;
  categories: string[];
  reason: string;
  subject: string;
  userMessage: string;
  includeFlagged: boolean;
  includeProtectedChats: boolean;
  previewTotals: Counts;
  previewFiles: number;
  previewedAt: string | null;
  resultTotals: Counts;
  resultCollateral: Counts;
  mail: ResetMailSummary;
  own: boolean;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: ResetProgress;
  targets: ResetTargetRow[];
};

function progressOf(value: unknown): ResetProgress {
  const r = asRecord(value);
  return { total: num(r.total), done: num(r.done), failed: num(r.failed), skipped: num(r.skipped), open: num(r.open) };
}

/** One job with progress and, per person, status and numbers (never e-mail addresses). */
export async function fetchResetJob(jobId: string): Promise<ResetJob> {
  const raw = asRecord(await rpc("admin_reset_job_status", { p_job_id: jobId }));
  const preview = asRecord(raw.preview);
  return {
    id: str(raw.id),
    status: jobStatus(raw.status),
    mode: resetMode(raw.mode),
    categories: asArray(raw.categories).map(str),
    reason: str(raw.reason),
    subject: str(raw.subject),
    userMessage: str(raw.user_message),
    includeFlagged: bool(raw.include_flagged),
    includeProtectedChats: bool(raw.include_protected_chats),
    previewTotals: toCounts(preview.totals),
    previewFiles: num(preview.files),
    previewedAt: strOrNull(raw.previewed_at),
    resultTotals: toCounts(asRecord(raw.result).totals),
    resultCollateral: toCounts(asRecord(asRecord(raw.result).collateral).totals),
    mail: (() => {
      const m = asRecord(raw.mail);
      return { pending: num(m.pending), sent: num(m.sent), failed: num(m.failed), notConfigured: num(m.not_configured), inApp: num(m.in_app) };
    })(),
    own: bool(raw.own),
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
    confirmedAt: strOrNull(raw.confirmed_at),
    startedAt: strOrNull(raw.started_at),
    finishedAt: strOrNull(raw.finished_at),
    progress: progressOf(raw.progress),
    targets: asArray(raw.targets).map((value) => {
      const r = asRecord(value);
      return {
        targetId: str(r.target_id),
        userId: strOrNull(r.user_id),
        username: strOrNull(r.username),
        displayName: strOrNull(r.display_name),
        userHash: str(r.user_hash),
        flagged: bool(r.flagged),
        status: str(r.status),
        error: strOrNull(r.error),
        counts: toCounts(r.counts),
        result: toCounts(r.result),
        emailStatus: str(r.email_status),
        inApp: bool(r.in_app),
        role: str(r.role) === "collateral" ? "collateral" : "selected",
        attempts: num(r.attempts),
      };
    }),
  };
}

const RUN_ERRORS: Record<string, string> = {
  unauthorized: "Nicht angemeldet.",
  forbidden: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  invalid_job: "Ungültiger Auftrag.",
  not_authorized: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  job_not_found: "Auftrag nicht gefunden.",
  not_job_owner: "Nur wer den Auftrag erstellt hat, darf ihn ausführen.",
  job_wrong_state: "Der Auftrag ist nicht bestätigt.",
  full_reset_disabled: "Komplettes Löschen ist ausgeschaltet (app_settings.allow_full_reset).",
  other_job_active: "Ein anderer Auftrag läuft bereits.",
};

/** Outcome of sending notification mails (counts only, never addresses). */
export type ResetMailRun = { configured: boolean; sent: number; failed: number; stopped: string | null; message: string | null };

function mailRunOf(value: unknown): ResetMailRun | null {
  if (value === undefined || value === null) return null;
  const m = asRecord(value);
  return { configured: bool(m.configured), sent: num(m.sent), failed: num(m.failed), stopped: strOrNull(m.stopped), message: strOrNull(m.message) };
}

export type ResetBatchResult = ResetProgress & { status: string; failedInBatch: number; mail: ResetMailRun | null };

/** One batch of the Edge Function run_data_reset; returns the progress after it. */
export async function runResetBatch(jobId: string): Promise<ResetBatchResult> {
  const { data, error } = await supabase.functions.invoke("run_data_reset", { body: { job_id: jobId } });
  if (error) {
    const context: unknown = (error as { context?: unknown }).context;
    let code = "";
    if (context instanceof Response) {
      try {
        code = str(asRecord(await context.json()).error);
      } catch {
        code = "";
      }
    }
    throw new ApiError(RUN_ERRORS[code] ?? "Ausführung fehlgeschlagen. Ist die Edge Function run_data_reset deployt?");
  }
  const r = asRecord(data);
  return { ...progressOf(r), status: str(r.status), failedInBatch: num(r.failed_in_batch), mail: mailRunOf(r.mail) };
}

/** "Offene Mails senden": notification mails of a finished job that are still waiting (quota). */
export async function sendResetMails(jobId: string): Promise<ResetMailRun> {
  const { data, error } = await supabase.functions.invoke("run_data_reset", { body: { job_id: jobId, action: "send_mails" } });
  if (error) throw new ApiError("Mails konnten nicht gesendet werden. Ist die Edge Function run_data_reset deployt?");
  return mailRunOf(asRecord(data).mail) ?? { configured: false, sent: 0, failed: 0, stopped: null, message: null };
}

/** Whether a mail provider is set up (secrets of the Edge Function). */
export async function fetchResetMailStatus(): Promise<{ configured: boolean; reason: string | null }> {
  const { data, error } = await supabase.functions.invoke("run_data_reset", { body: { action: "mail_status" } });
  if (error) return { configured: false, reason: "Edge Function run_data_reset ist nicht erreichbar (nicht deployt?)." };
  const r = asRecord(data);
  return { configured: bool(r.configured), reason: strOrNull(r.reason) };
}

/**
 * A fresh second factor before confirming a reset: the database accepts the confirmation only
 * while the last TOTP step of this session is at most 5 minutes old.
 */
export async function verifyTotpAgain(code: string): Promise<void> {
  const digits = code.replace(/\s/g, "");
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new ApiError("Zwei-Faktor-Status konnte nicht geladen werden.");
  const factor = factors.totp.find((f) => f.status === "verified");
  if (factor === undefined) throw new ApiError("Kein bestätigter Zwei-Faktor-Code eingerichtet.");
  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
  if (verifyError) throw new ApiError("Code ungültig oder abgelaufen.");
}

// ------------------------------------------------------------------ e-mail notices (admins)

const MAIL_FUNCTION = "send_admin_mail";
const MAIL_BUCKET = "mail-attachments";

const MAIL_ERRORS: Record<string, string> = {
  unauthorized: "Nicht angemeldet.",
  forbidden: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  not_authorized: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  email_not_configured: "Kein Mail-Dienst eingerichtet (Secrets EMAIL_API_KEY und EMAIL_FROM).",
  invalid_category: "Bitte eine Kategorie wählen.",
  invalid_subject: "Betreff fehlt, ist länger als 150 Zeichen oder enthält einen Zeilenumbruch.",
  invalid_body: "Text fehlt oder ist länger als 10 000 Zeichen.",
  invalid_attachments: "Ungültiger Anhang.",
  too_many_attachments: "Höchstens 3 Anhänge.",
  attachments_too_large: "Anhänge zusammen höchstens 5 MB.",
  attachment_missing: "Ein Anhang fehlt (älter als 24 Stunden?). Bitte neu hochladen.",
  attachment_type_not_allowed: "Ein Anhang ist keine echte PDF-, PNG-, JPG- oder Textdatei.",
  no_own_address: "Dein Konto hat keine E-Mail-Adresse für die Testmail.",
  send_failed: "Die Testmail konnte nicht gesendet werden.",
  test_required: "Zuerst eine Testmail mit genau diesem Inhalt senden (gilt 60 Minuten).",
  invalid_audience: "Ungültige Empfängerauswahl.",
  invalid_recipients: "Ungültige Empfängerauswahl.",
  recipient_not_allowed: "Gesperrte, gebannte oder gelöschte Konten können keine Mitteilung bekommen. Bitte die Auswahl prüfen.",
  no_recipients: "Niemand ausgewählt.",
  too_many_recipients: "Höchstens 500 Empfänger pro Sendung.",
  confirm_count_mismatch: "Die eingegebene Anzahl stimmt nicht mit der Empfängerzahl überein.",
  service_only_required: "Beim Senden an alle muss bestätigt werden, dass es eine Servicemitteilung ist.",
  template_not_found: "Vorlage nicht gefunden.",
  invalid_template_name: "Name der Vorlage fehlt oder ist zu lang.",
  too_many_templates: "Höchstens 100 Vorlagen.",
  campaign_not_open: "Diese Sendung ist bereits abgeschlossen.",
  campaign_not_found: "Sendung nicht gefunden.",
};

async function mailRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError(MAIL_ERRORS[error.message] ?? ERROR_TEXTS[error.message] ?? `Fehler: ${error.message}`);
  return data;
}

async function invokeMail(body: Record<string, unknown>): Promise<Json> {
  const { data, error } = await supabase.functions.invoke(MAIL_FUNCTION, { body });
  if (error) {
    const context: unknown = (error as { context?: unknown }).context;
    let code = "";
    let message = "";
    if (context instanceof Response) {
      try {
        const r = asRecord(await context.json());
        code = str(r.error);
        message = str(r.message);
      } catch {
        code = "";
      }
    }
    const text = MAIL_ERRORS[code] ?? "Fehler beim Senden. Ist die Edge Function send_admin_mail deployt?";
    throw new ApiError(message !== "" ? `${text} ${message}` : text);
  }
  return asRecord(data);
}

export type MailSettings = { activeAccounts: number; maxRecipients: number; confirmCountAbove: number };

export async function fetchMailSettings(): Promise<MailSettings> {
  const r = asRecord(await mailRpc("admin_mail_settings", {}));
  return { activeAccounts: num(r.active_accounts), maxRecipients: num(r.max_recipients), confirmCountAbove: num(r.confirm_count_above) };
}

export async function fetchMailStatus(): Promise<{ configured: boolean; reason: string | null }> {
  const { data, error } = await supabase.functions.invoke(MAIL_FUNCTION, { body: { action: "status" } });
  if (error) return { configured: false, reason: "Edge Function send_admin_mail ist nicht erreichbar (nicht deployt?)." };
  const r = asRecord(data);
  return { configured: bool(r.configured), reason: strOrNull(r.reason) };
}

export type MailCandidate = { userId: string; username: string; displayName: string };

export async function fetchMailCandidates(query: string): Promise<MailCandidate[]> {
  return asArray(await mailRpc("admin_mail_candidates", { p_query: query.trim() })).map((value) => {
    const r = asRecord(value);
    return { userId: str(r.user_id), username: str(r.username), displayName: str(r.display_name) };
  });
}

export type MailTemplate = { id: string; name: string; category: string; subject: string; body: string; updatedAt: string };

export async function fetchMailTemplates(): Promise<MailTemplate[]> {
  return asArray(await mailRpc("admin_mail_templates", {})).map((value) => {
    const r = asRecord(value);
    return { id: str(r.id), name: str(r.name), category: str(r.category), subject: str(r.subject), body: str(r.body), updatedAt: str(r.updated_at) };
  });
}

export async function saveMailTemplate(id: string | null, name: string, category: string, subject: string, body: string): Promise<string> {
  return str(await mailRpc("admin_mail_save_template", { p_id: id, p_name: name, p_category: category, p_subject: subject, p_body: body }));
}

export async function deleteMailTemplate(id: string): Promise<void> {
  await mailRpc("admin_mail_delete_template", { p_id: id });
}

export type MailCounts = { sent: number; failed: number; pending: number; skipped: number };

function mailCounts(value: unknown): MailCounts {
  const r = asRecord(value);
  return { sent: num(r.sent), failed: num(r.failed), pending: num(r.pending), skipped: num(r.skipped) };
}

export type MailCampaignRow = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  category: string;
  audience: string;
  subject: string;
  recipientCount: number;
  attachmentCount: number;
  status: string;
  stopReason: string | null;
  counts: MailCounts;
  createdBy: string | null;
};

function campaignRowOf(r: Json): Omit<MailCampaignRow, "createdBy"> {
  return {
    id: str(r.id),
    createdAt: str(r.created_at),
    finishedAt: strOrNull(r.finished_at),
    category: str(r.category),
    audience: str(r.audience),
    subject: str(r.subject),
    recipientCount: num(r.recipient_count),
    attachmentCount: num(r.attachment_count),
    status: str(r.status),
    stopReason: strOrNull(r.stop_reason),
    counts: mailCounts(r.counts),
  };
}

export async function fetchMailCampaigns(): Promise<MailCampaignRow[]> {
  return asArray(await mailRpc("admin_mail_campaigns", { p_limit: 100, p_offset: 0 })).map((value) => {
    const r = asRecord(value);
    return { ...campaignRowOf(r), createdBy: strOrNull(r.created_by_username) };
  });
}

export type MailRecipientRow = { username: string | null; displayName: string | null; status: string; error: string | null; sentAt: string | null };
export type MailCampaign = Omit<MailCampaignRow, "createdBy"> & { bodyHash: string; recipients: MailRecipientRow[] };

export async function fetchMailCampaign(id: string): Promise<MailCampaign> {
  const r = asRecord(await mailRpc("admin_mail_campaign", { p_campaign_id: id }));
  return {
    ...campaignRowOf(r),
    bodyHash: str(r.body_hash),
    recipients: asArray(r.recipients).map((value) => {
      const x = asRecord(value);
      return { username: strOrNull(x.username), displayName: strOrNull(x.display_name), status: str(x.status), error: strOrNull(x.error), sentAt: strOrNull(x.sent_at) };
    }),
  };
}

/** Uploads one attachment into the admin's own folder of the private bucket; returns its path. */
export async function uploadMailAttachment(file: File, draftId: string, name: string, contentType: string): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (userId === undefined) throw new ApiError("Nicht angemeldet.");
  const path = `${userId}/${draftId}/${name}`;
  const { error } = await supabase.storage.from(MAIL_BUCKET).upload(path, file, { contentType, upsert: false });
  if (error) throw new ApiError("Anhang konnte nicht hochgeladen werden (Typ oder Grösse nicht erlaubt?).");
  return path;
}

export async function removeMailAttachment(path: string): Promise<void> {
  await supabase.storage.from(MAIL_BUCKET).remove([path]);
}

export type MailContentInput = { category: string; subject: string; body: string; attachments: string[] };
export type MailAttachmentInfo = { name: string; size: number; type: string };

/** Test mail to the own address; afterwards the same content may be sent (for 60 minutes). */
export async function sendTestMail(input: MailContentInput): Promise<MailAttachmentInfo[]> {
  const r = await invokeMail({ action: "test", ...input });
  return asArray(r.attachments).map((value) => {
    const a = asRecord(value);
    return { name: str(a.name), size: num(a.size), type: str(a.type) };
  });
}

export type MailRun = {
  campaignId: string | null;
  campaigns: (MailCounts & { id: string; status: string })[];
  more: boolean;
  message: string | null;
};

function noticeRunOf(r: Json): MailRun {
  return {
    campaignId: strOrNull(r.campaign_id),
    campaigns: asArray(r.campaigns).map((value) => {
      const c = asRecord(value);
      return { id: str(c.id), status: str(c.status), ...mailCounts(c) };
    }),
    more: bool(r.more),
    message: strOrNull(r.message),
  };
}

export type MailSendInput = MailContentInput & {
  audience: "single" | "selected" | "all";
  userIds: string[];
  confirmCount: number | null;
  serviceOnly: boolean;
  templateId: string | null;
};

export async function sendMailCampaign(input: MailSendInput): Promise<MailRun> {
  return noticeRunOf(
    await invokeMail({
      action: "send",
      category: input.category,
      subject: input.subject,
      body: input.body,
      attachments: input.attachments,
      audience: input.audience,
      user_ids: input.userIds,
      confirm_count: input.confirmCount,
      service_only: input.serviceOnly,
      template_id: input.templateId,
    }),
  );
}

/** Sends more of one open campaign (time limit of the function), or every waiting one ("Rest senden"). */
export async function continueMail(campaignId: string | null): Promise<MailRun> {
  return noticeRunOf(await invokeMail(campaignId === null ? { action: "send_pending" } : { action: "continue", campaign_id: campaignId }));
}

// ------------------------------------------------------------------ logos and presets (admins)

import type { DesignTarget } from "./logoLibrary";

export type { DesignTarget };

export const TARGET_LABELS: Record<DesignTarget, string> = { app_login: "App-Anmeldung", dashboard: "Dashboard" };

const LOGO_ERRORS: Record<string, string> = {
  not_authorized: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  forbidden: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  invalid_name: "Name fehlt oder ist länger als 40 Zeichen.",
  invalid_logo: "Das Logo erfüllt die Regeln nicht.",
  invalid_hash: "Ungültige Prüfsumme der Datei.",
  rights_required: "Bitte bestätigen, dass du das Logo verwenden darfst.",
  too_many_logos: "Höchstens 30 hochgeladene Logos. Bitte zuerst ein nicht verwendetes löschen.",
  logo_not_found: "Logo nicht gefunden.",
  builtin_logo: "Eingebaute Logos lassen sich nicht löschen und in ihrer Form nicht ändern.",
  logo_active: "Ein aktives Logo lässt sich nicht löschen. Zuerst ein anderes Logo aktivieren.",
  invalid_targets: "Bitte mindestens ein Ziel wählen.",
  preset_not_found: "Preset nicht gefunden.",
  invalid_params: "Ein Parameter liegt ausserhalb des erlaubten Bereichs.",
  invalid_spec: "Die Animation erfüllt die Regeln nicht (Bereiche, Anzahl Spuren und Keyframes oder Aufwand).",
  too_many_presets: "Höchstens 50 eigene Presets.",
  builtin_preset: "Eingebaute Presets bleiben unverändert. Bitte duplizieren.",
  preset_in_use: "Das Preset wird noch von einem Logo verwendet.",
  rate_limited: "Höchstens 10 Prüfungen pro Stunde. Bitte später erneut versuchen.",
  too_large: "Die Datei ist grösser als 200 KB.",
};

async function logoRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError(LOGO_ERRORS[error.message] ?? ERROR_TEXTS[error.message] ?? `Fehler: ${error.message}`);
  return data;
}

export type LogoRow = {
  id: string;
  name: string;
  kind: "builtin" | "uploaded";
  spec: unknown;
  presetId: string;
  presetName: string;
  createdAt: string;
  uploadedBy: string | null;
  targets: DesignTarget[];
};

function targetsOf(value: unknown): DesignTarget[] {
  return asArray(value).filter((t): t is DesignTarget => t === "app_login" || t === "dashboard");
}

export async function fetchLogos(): Promise<LogoRow[]> {
  return asArray(await logoRpc("admin_logo_list", {})).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      name: str(r.name),
      kind: r.kind === "builtin" ? "builtin" : "uploaded",
      spec: r.spec,
      presetId: str(r.preset_id),
      presetName: str(r.preset_name),
      createdAt: str(r.created_at),
      uploadedBy: strOrNull(r.uploaded_by),
      targets: targetsOf(r.targets),
    };
  });
}

export type LogoSave = {
  id: string | null;
  name: string;
  /** null keeps the shapes (built-in logos). */
  spec: unknown;
  presetId: string;
  sourceHash: string | null;
  fileName: string | null;
  rightsConfirmed: boolean;
};

export async function saveLogo(input: LogoSave): Promise<string> {
  return str(
    await logoRpc("admin_logo_save", {
      p_id: input.id,
      p_name: input.name,
      p_spec: input.spec,
      p_preset_id: input.presetId,
      p_source_hash: input.sourceHash,
      p_file_name: input.fileName,
      p_rights_confirmed: input.rightsConfirmed,
    }),
  );
}

export async function deleteLogo(id: string): Promise<void> {
  await logoRpc("admin_logo_delete", { p_id: id });
}

export async function activateLogo(id: string, targets: DesignTarget[]): Promise<void> {
  await logoRpc("admin_logo_activate", { p_logo_id: id, p_targets: targets });
}

export type PresetRow = {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  /** Animation v2, or v1 parameters of an older preset (read with parseAnimation). */
  animation: unknown;
  /** The v1 parameters behind the tab "Einfach", if the preset was made there. */
  params: unknown;
  usedBy: number;
  versions: number;
};

export async function fetchPresets(): Promise<PresetRow[]> {
  return asArray(await logoRpc("admin_preset_list", {})).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      name: str(r.name),
      kind: r.kind === "builtin" ? "builtin" : "custom",
      animation: r.spec_version === 2 ? r.spec : r.params,
      params: r.params ?? null,
      usedBy: num(r.used_by),
      versions: num(r.versions),
    };
  });
}

/** Saves an Animation v2 (checked again on the server); `params` only when made in the tab "Einfach". */
export async function savePreset(id: string | null, name: string, spec: unknown, params: unknown = null): Promise<string> {
  return str(await logoRpc("admin_preset_save", { p_id: id, p_name: name, p_spec: spec, p_params: params }));
}

export type PresetVersionRow = { id: string; version: number; name: string; spec: unknown; params: unknown; savedAt: string; savedBy: string | null };

/** The last saves of a preset, newest first (at most 10). */
export async function fetchPresetVersions(presetId: string): Promise<PresetVersionRow[]> {
  return asArray(await logoRpc("admin_preset_versions", { p_preset_id: presetId })).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      version: num(r.version),
      name: str(r.name),
      spec: r.spec,
      params: r.params ?? null,
      savedAt: str(r.saved_at),
      savedBy: strOrNull(r.saved_by),
    };
  });
}

export async function deletePreset(id: string): Promise<void> {
  await logoRpc("admin_preset_delete", { p_id: id });
}

export type RoleSuggestionRow = { role: "fill" | "cutout" | "stroke"; omit: boolean; reason: string | null };
export type LogoImport = { spec: unknown; suggestions: RoleSuggestionRow[]; ignored: number; sourceHash: string; fileName: string };

/** Sends the SVG text to the Edge Function logo_import; the checked structure comes back (or why not). */
export async function importLogo(svg: string, fileName: string): Promise<LogoImport> {
  const { data, error } = await supabase.functions.invoke("logo_import", { body: { svg, file_name: fileName } });
  if (error) {
    const context: unknown = (error as { context?: unknown }).context;
    let code = "";
    let message = "";
    if (context instanceof Response) {
      try {
        const r = asRecord(await context.json());
        code = str(r.error);
        message = str(r.message);
      } catch {
        code = "";
      }
    }
    throw new ApiError(message !== "" ? message : (LOGO_ERRORS[code] ?? "Prüfung fehlgeschlagen. Ist die Edge Function logo_import deployt?"));
  }
  const r = asRecord(data);
  return {
    spec: r.spec,
    suggestions: asArray(r.suggestions).map((value) => {
      const s = asRecord(value);
      const role = s.role === "cutout" || s.role === "stroke" ? s.role : "fill";
      return { role, omit: bool(s.omit), reason: strOrNull(s.reason) };
    }),
    ignored: num(r.ignored),
    sourceHash: str(r.source_hash),
    fileName: str(r.file_name),
  };
}

/** The active dashboard logo with its preset (public, also before signing in). */
export async function fetchDashboardLogo(): Promise<{ spec: unknown; animation: unknown } | null> {
  const { data, error } = await supabase.rpc("get_dashboard_logo");
  if (error || data === null) return null;
  const r = asRecord(data);
  return { spec: r.logo, animation: r.preset };
}

// ------------------------------------------------------------------ design of the app login screen (admins)

export type AppLoginDesign = { palette: "color" | "bw"; mode: "system" | "light" | "dark"; animation: boolean };

const DESIGN_ERRORS: Record<string, string> = {
  not_authorized: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  invalid_palette: "Unbekannte Farbe.",
  invalid_mode: "Unbekannter Modus.",
  invalid_animation: "Ungültige Einstellung der Animation.",
};

/** What the app's login screen shows now (the same public answer the app reads), with its logo. */
export async function fetchAppLoginDesign(): Promise<AppLoginDesign & { logo: unknown; preset: unknown; colors: ColorSet }> {
  const { data, error } = await supabase.rpc("get_public_design_config");
  if (error) throw new ApiError("Die Einstellungen der App konnten nicht geladen werden.");
  const r = asRecord(data);
  return {
    palette: r.palette === "color" ? "color" : "bw",
    mode: r.mode === "light" || r.mode === "dark" ? r.mode : "system",
    animation: r.animation !== "off",
    logo: r.logo,
    preset: r.preset,
    colors: parseColorSet(r.colors) ?? DEFAULT_COLOR_SET,
  };
}

/** Saves the look of the app's login screen (logged with before and after). */
export async function saveAppLoginDesign(design: AppLoginDesign): Promise<void> {
  const { error } = await supabase.rpc("set_app_design_config", {
    p_palette: design.palette,
    p_mode: design.mode,
    p_animation: design.animation ? "on" : "off",
  });
  if (error) throw new ApiError(DESIGN_ERRORS[error.message] ?? `Fehler: ${error.message}`);
}

// ------------------------------------------------------------------ colour sets ("Hauptfarben", admins)

export type { ColorTarget };
export const COLOR_TARGET_LABELS: Record<ColorTarget, string> = { dashboard_colors: "Dashboard", app_login_colors: "App-Anmeldung" };

const COLOR_ERRORS: Record<string, string> = {
  not_authorized: "Nur Admins mit Zwei-Faktor-Anmeldung.",
  invalid_name: "Name fehlt oder ist länger als 40 Zeichen.",
  invalid_hex: "Farben bitte als #RRGGBB angeben.",
  accent_dark_contrast: "Die Farbe für Dunkel hebt sich zu wenig vom dunklen Hintergrund ab.",
  accent_light_contrast: "Die Farbe für Hell hebt sich zu wenig vom hellen Hintergrund ab.",
  on_accent_dark: "Auf der Farbe für Dunkel ist keine Schrift gut lesbar.",
  on_accent_light: "Auf der Farbe für Hell ist keine Schrift gut lesbar.",
  invalid_chart: "Höchstens 8 Diagrammfarben als #RRGGBB.",
  chart_contrast: "Eine Diagrammfarbe hebt sich nicht ausreichend ab.",
  too_many_color_sets: "Höchstens 20 eigene Farbsätze.",
  color_set_not_found: "Farbsatz nicht gefunden.",
  builtin_color_set: "Eingebaute Farbsätze bleiben unverändert. Bitte duplizieren.",
  color_set_active: "Ein aktiver Farbsatz lässt sich nicht löschen. Zuerst einen anderen aktivieren.",
  invalid_targets: "Bitte mindestens ein Ziel wählen.",
};

async function colorRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError(COLOR_ERRORS[error.message] ?? ERROR_TEXTS[error.message] ?? `Fehler: ${error.message}`);
  return data;
}

export type ColorSetRow = {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  accentDark: string;
  accentLight: string;
  chartColors: string[] | null;
  createdBy: string | null;
  targets: ColorTarget[];
};

export async function fetchColorSets(): Promise<ColorSetRow[]> {
  return asArray(await colorRpc("admin_color_list", {})).map((value) => {
    const r = asRecord(value);
    return {
      id: str(r.id),
      name: str(r.name),
      kind: r.kind === "builtin" ? "builtin" : "custom",
      accentDark: str(r.accent_dark),
      accentLight: str(r.accent_light),
      chartColors: Array.isArray(r.chart_colors) ? r.chart_colors.map(str) : null,
      createdBy: strOrNull(r.created_by),
      targets: asArray(r.targets).filter((t): t is ColorTarget => t === "dashboard_colors" || t === "app_login_colors"),
    };
  });
}

export async function saveColorSet(id: string | null, name: string, accentDark: string, accentLight: string, chartColors: string[] | null): Promise<string> {
  return str(await colorRpc("admin_color_save", { p_id: id, p_name: name, p_dark: accentDark, p_light: accentLight, p_chart: chartColors }));
}

export async function deleteColorSet(id: string): Promise<void> {
  await colorRpc("admin_color_delete", { p_id: id });
}

export async function activateColorSet(id: string, targets: ColorTarget[]): Promise<void> {
  await colorRpc("admin_color_activate", { p_color_id: id, p_targets: targets });
}
