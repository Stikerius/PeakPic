import { supabase } from "@/lib/supabase";
import type { ReportReason, ReportStatus, ReportTargetType } from "@/types/database";

export const REPORT_DETAILS_MAX_LENGTH = 500;

/** Fixed list, same keys as the database (reports.reason). */
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Belästigung oder Mobbing" },
  { value: "nudity", label: "Nacktheit oder sexuelle Inhalte" },
  { value: "violence", label: "Gewalt oder Drohung" },
  { value: "hate", label: "Hassrede" },
  { value: "copyright", label: "Urheberrechtsverletzung" },
  { value: "self_harm", label: "Selbstgefährdung" },
  { value: "non_consensual", label: "Zeigt Personen ohne Einwilligung" },
  { value: "other", label: "Sonstiges" },
];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Eingegangen",
  in_review: "Wird geprüft",
  resolved: "Erledigt",
  dismissed: "Kein Verstoss festgestellt",
};

export const REPORT_TARGET_LABELS: Record<ReportTargetType, string> = {
  post: "Beitrag",
  story: "Story",
  comment: "Kommentar",
  message: "Nachricht",
  profile: "Profil",
};

export type MyReport = {
  id: string;
  targetType: ReportTargetType;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: string;
  handledAt: string | null;
};

function reportErrorMessage(message: string | undefined): string {
  switch (message) {
    case "report_exists":
      return "Du hast das schon gemeldet. Wir prüfen es.";
    case "report_limit":
      return "Du hast heute schon viele Meldungen gesendet. Versuche es morgen wieder.";
    case "report_target_not_found":
      return "Der Inhalt ist nicht mehr verfügbar.";
    case "report_own_content":
      return "Eigene Inhalte kannst du nicht melden.";
    case "account_inactive":
      return "Dein Konto ist gesperrt.";
    default:
      return "Die Meldung konnte nicht gesendet werden. Prüfe deine Verbindung.";
  }
}

/**
 * Reports a post, story, comment, profile or chat message. The database checks that I may see
 * it, limits reports per day and keeps a copy of reported messages with some context.
 */
export async function submitReport(
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  details: string,
): Promise<void> {
  const trimmed = details.trim().slice(0, REPORT_DETAILS_MAX_LENGTH);
  const { error } =
    targetType === "message"
      ? await supabase.rpc("report_message", { message_id: targetId, reason, details: trimmed })
      : await supabase.rpc("report_content", {
          p_target_type: targetType,
          p_target_id: targetId,
          p_reason: reason,
          p_details: trimmed,
        });
  if (error) throw new Error(reportErrorMessage(error.message));
}

/** "Meine Meldungen": status only, no decision notes. */
export async function listMyReports(): Promise<MyReport[]> {
  const { data, error } = await supabase.rpc("get_my_reports", {});
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    targetType: row.target_type,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  }));
}
