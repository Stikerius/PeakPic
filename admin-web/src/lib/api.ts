import { asArray, asRecord, bool, isRecord, num, str, strOrNull, type Json } from "./decode";
import { SIGNED_URL_SECONDS, supabase } from "./supabase";

/**
 * Wrappers for the staff functions of the database (mod_* / admin_*). The database checks the
 * role and the two-factor session on every call; nothing here grants anything.
 */

export type StaffRole = "moderator" | "admin";
export type ContentType = "post" | "story" | "comment" | "message" | "plan";

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
