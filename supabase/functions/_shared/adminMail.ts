// Pure: e-mail notices from the dashboard ("Mitteilungen"), no Deno APIs. The dashboard shows the
// same mail with admin-web/src/lib/adminMail.ts; src/lib/__tests__/adminMail.test.ts checks both
// agree. Plain text only (the HTML version is the same text, escaped, see textToHtml); no links
// are added, no tracking. The limits are the same as public.mail_limits() in schema.sql.

export const ADMIN_MAIL_LIMITS = {
  maxRecipients: 500,
  confirmCountAbove: 5,
  subjectMax: 150,
  bodyMax: 10_000,
  maxFiles: 3,
  // Resend allows 40 MB per mail (after Base64); 5 MB keeps mails small for every inbox.
  maxTotalBytes: 5 * 1024 * 1024,
} as const;

export type MailCategory = "account" | "legal" | "operations" | "personal";

/** Service notices only; there is deliberately no category for advertising. */
export const MAIL_CATEGORIES: readonly (readonly [MailCategory, string])[] = [
  ["account", "Konto und Sicherheit"],
  ["legal", "Rechtliches"],
  ["operations", "Betrieb und Wartung"],
  ["personal", "Persönliche Nachricht"],
];

export function mailCategoryLabel(key: string): string | null {
  return MAIL_CATEGORIES.find(([k]) => k === key)?.[1] ?? null;
}

export type MailContent = { category: MailCategory; subject: string; body: string };

/** Same rules as public.mail_check_content(). */
export function checkMailContent(
  category: unknown,
  subject: unknown,
  body: unknown,
): { ok: true; content: MailContent } | { ok: false; error: "invalid_category" | "invalid_subject" | "invalid_body" } {
  if (typeof category !== "string" || mailCategoryLabel(category) === null) return { ok: false, error: "invalid_category" };
  if (
    typeof subject !== "string" ||
    subject.trim() === "" ||
    subject.length > ADMIN_MAIL_LIMITS.subjectMax ||
    /[\r\n]/.test(subject)
  ) {
    return { ok: false, error: "invalid_subject" };
  }
  if (typeof body !== "string" || body.trim() === "" || body.length > ADMIN_MAIL_LIMITS.bodyMax) {
    return { ok: false, error: "invalid_body" };
  }
  return { ok: true, content: { category: category as MailCategory, subject: subject.trim(), body } };
}

/** The mail as recipients get it: the text, then why they get it and whom to ask. */
export function buildAdminMail(content: MailContent, supportEmail: string | null): { subject: string; text: string } {
  const body = content.body.replace(/\r\n?/g, "\n").trim();
  const contact =
    supportEmail !== null && supportEmail !== ""
      ? `Fragen? Antworte auf diese E-Mail oder schreib an ${supportEmail}.`
      : "Fragen? Antworte auf diese E-Mail.";
  const footer = [
    `Art der Mitteilung: ${mailCategoryLabel(content.category) ?? ""}`,
    "Du erhältst diese Nachricht, weil du ein PeakPic-Konto hast.",
    contact,
  ].join("\n");
  return { subject: content.subject.trim(), text: `${body}\n\n--\n${footer}` };
}

/** Subject of the test mail to the admin's own address. */
export function testSubject(subject: string): string {
  return `[Test] ${subject}`.slice(0, ADMIN_MAIL_LIMITS.subjectMax);
}
