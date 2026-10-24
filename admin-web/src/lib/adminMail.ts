// Copy of supabase/functions/_shared/adminMail.ts (and the file name rules of
// _shared/mailAttachments.ts) for the preview and the checks before uploading: the dashboard can't
// import from the functions folder. src/lib/__tests__/adminMail.test.ts checks both agree; change
// both together. The server checks everything again.

export const ADMIN_MAIL_LIMITS = {
  maxRecipients: 500,
  confirmCountAbove: 5,
  subjectMax: 150,
  bodyMax: 10_000,
  maxFiles: 3,
  maxTotalBytes: 5 * 1024 * 1024,
} as const;

export type MailCategory = "account" | "legal" | "operations" | "personal";

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

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

export type AttachmentExt = "pdf" | "png" | "jpg" | "txt";

export function sanitizeFilename(name: string, ext: AttachmentExt): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const withoutExt = last.includes(".") ? last.slice(0, last.lastIndexOf(".")) : last;
  const base = withoutExt
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? "_")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 80);
  return `${base !== "" ? base : "anhang"}.${ext}`;
}

/** The extension a file name claims (only a first check; the server reads the bytes). */
export function claimedExtension(name: string): AttachmentExt | null {
  const match = /\.(pdf|png|jpe?g|txt)$/i.exec(name);
  if (match === null) return null;
  const ext = (match[1] ?? "").toLowerCase();
  return ext === "jpeg" ? "jpg" : (ext as AttachmentExt);
}

/** Why a set of files can't be attached, or null. */
export function attachmentProblem(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > ADMIN_MAIL_LIMITS.maxFiles) return `Höchstens ${ADMIN_MAIL_LIMITS.maxFiles} Anhänge.`;
  if (files.some((f) => claimedExtension(f.name) === null)) return "Erlaubt sind nur PDF, PNG, JPG und TXT.";
  if (files.some((f) => f.size === 0)) return "Leere Dateien können nicht angehängt werden.";
  if (files.reduce((sum, f) => sum + f.size, 0) > ADMIN_MAIL_LIMITS.maxTotalBytes) return "Anhänge zusammen höchstens 5 MB.";
  return null;
}
