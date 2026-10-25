// Copy of supabase/functions/_shared/resetMail.ts for the preview in the wizard (the dashboard
// can't import from the functions folder). src/lib/__tests__/mail.test.ts checks both give the
// same mail; change both together.

export type ResetMailInput = {
  role: "selected" | "collateral";
  mode: "categories" | "full";
  categories: readonly string[];
  reason: string;
  subject: string | null;
  userMessage: string | null;
  supportEmail: string | null;
};

const CATEGORY_LABELS: readonly [string, string][] = [
  ["chats", "Chats"],
  ["activities", "Aktivitäten"],
  ["plans", "Trainingspläne"],
  ["posts", "Beiträge"],
  ["stories", "Storys und Highlights"],
  ["social", "Follower und Gefolgte"],
  ["notifications", "Benachrichtigungen"],
  ["surveys", "Umfrage-Teilnahmen"],
  ["other", "Einstellungen und abgegebene Meldungen"],
];

export const DEFAULT_RESET_SUBJECT = "PeakPic: Daten in deinem Konto wurden gelöscht";
export const COLLATERAL_SUBJECT = "PeakPic: Unterhaltungen beendet";

/** "Beiträge, Storys und Highlights und Chats" in a fixed order. */
export function resetCategoryText(categories: readonly string[]): string {
  const labels = CATEGORY_LABELS.filter(([key]) => categories.includes(key)).map(([, label]) => label);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} sowie ${labels[labels.length - 1]}`;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function contactLine(supportEmail: string | null): string {
  return supportEmail !== null && supportEmail !== ""
    ? `Fragen? Antworte auf diese E-Mail oder schreib an ${supportEmail}.`
    : "Fragen? Antworte auf diese E-Mail.";
}

export function buildResetMail(input: ResetMailInput): { subject: string; text: string } {
  const reason = input.reason.trim();
  if (input.role === "collateral") {
    const text = [
      "Hallo,",
      "Eine oder mehrere deiner Unterhaltungen wurden im Rahmen einer Datenbereinigung beendet. Die Nachrichten darin sind für alle Beteiligten gelöscht.",
      `Grund: ${reason}`,
      "Dein Konto, deine Beiträge und alle anderen Daten bleiben unverändert.",
      contactLine(input.supportEmail),
      "Du erhältst diese Nachricht, weil du ein PeakPic-Konto hast.",
    ].join("\n\n");
    return { subject: COLLATERAL_SUBJECT, text };
  }
  const full = input.mode === "full";
  const what = full ? "dein Konto mit allen Daten" : resetCategoryText(input.categories);
  const intro = (input.userMessage ?? "").trim().replaceAll("{{kategorien}}", what).replaceAll("{{begruendung}}", reason);
  const text = [
    intro !== "" ? intro : "Hallo,",
    full ? "Gelöscht wurde: dein PeakPic-Konto mit allen Daten." : `Gelöscht wurden: ${what}.`,
    `Grund: ${reason}`,
    full
      ? "Aufbewahrt wird nur, was wir aus rechtlichen Gründen behalten müssen (zum Beispiel Protokolle der Moderation, ohne deinen Namen)."
      : "Unverändert bleiben dein Konto, dein Benutzername und alle Daten, die oben nicht genannt sind.",
    contactLine(input.supportEmail),
    full ? "Du erhältst diese Nachricht, weil du ein PeakPic-Konto hattest." : "Du erhältst diese Nachricht, weil du ein PeakPic-Konto hast.",
  ].join("\n\n");
  const subject = oneLine(input.subject ?? "").replaceAll("{{kategorien}}", what).replaceAll("{{begruendung}}", oneLine(reason));
  return { subject: (subject !== "" ? subject : DEFAULT_RESET_SUBJECT).slice(0, 150), text };
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Plain text to simple HTML: escaped, blank lines become paragraphs, single breaks <br>. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`);
  return `<!doctype html><html lang="de"><body>${paragraphs.join("")}</body></html>`;
}
