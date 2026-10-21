import { asArray, asRecord, bool, isRecord, num, str, strOrNull, type Json } from "./decode";
import { SIGNED_URL_SECONDS, supabase } from "./supabase";

/**
 * Wrappers for the staff functions of the database (mod_* / admin_*). The database checks the
 * role and the two-factor session on every call; nothing here grants anything.
 */

export type StaffRole = "moderator" | "admin";
export type ContentType = "post" | "story" | "comment" | "message";

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
