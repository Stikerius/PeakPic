// Pure: what a failed send means (no Deno APIs, unit tested in src/lib/__tests__/mail.test.ts).
//
//  quota        daily or monthly sending quota reached: stop, keep the rest for later
//  rate_limit   too many requests per second: wait and retry, then stop and keep the rest
//  config       key, sender domain or account not usable (401/403): stop, nothing will work
//  rejected     this one mail is invalid (400/422, e.g. a broken address): mark it failed, go on
//  unavailable  provider or network down (5xx, no answer): stop, keep the rest for later

export type MailFailure = "quota" | "rate_limit" | "config" | "rejected" | "unavailable";

/** Resend answers {statusCode, name, message}; `name` is e.g. "daily_quota_exceeded". */
export function classifyMailError(status: number, name: string | null): MailFailure {
  if (status === 429) {
    return name === "daily_quota_exceeded" || name === "monthly_quota_exceeded" ? "quota" : "rate_limit";
  }
  if (status === 401 || status === 403) return "config";
  if (status === 400 || status === 422) return "rejected";
  if (status === 0 || status >= 500) return "unavailable";
  return "rejected";
}

/** Whether to stop sending the rest of a batch (everything except a single bad mail). */
export function stopsBatch(failure: MailFailure): boolean {
  return failure !== "rejected";
}

/** Shown in the dashboard. */
export const MAIL_FAILURE_TEXTS: Record<MailFailure, string> = {
  quota: "Kontingent erreicht. Die übrigen Mails warten und können später gesendet werden.",
  rate_limit: "Zu viele Mails auf einmal. Die übrigen Mails warten und können gleich noch einmal gesendet werden.",
  config: "Der Mail-Dienst lehnt den Versand ab (Schlüssel, Absender oder Domain prüfen).",
  rejected: "Die Mail wurde abgelehnt.",
  unavailable: "Der Mail-Dienst ist nicht erreichbar. Die übrigen Mails warten.",
};
