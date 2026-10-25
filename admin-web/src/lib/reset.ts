/**
 * Data reset ("Bereinigung"), the pure part: categories and labels, who can be selected, the
 * confirmation word, the mail text with placeholders, sums of the dry run and the steps of the
 * wizard. No React, no network (unit tested in src/lib/__tests__/adminReset.test.ts of the app).
 * The database checks everything again; nothing here grants anything.
 */

export type ResetMode = "categories" | "full";

export type CategoryKey = "chats" | "activities" | "plans" | "posts" | "stories" | "social" | "notifications" | "surveys" | "other";

export const CATEGORIES: readonly { key: CategoryKey; label: string; description: string }[] = [
  {
    key: "chats",
    label: "Chats",
    description:
      "Jede Unterhaltung der Ausgewählten wird für alle Beteiligten beendet, auch für nicht ausgewählte Konten. Chats mit geschützten Konten bleiben, dort verschwindet nur die Seite der Ausgewählten.",
  },
  { key: "activities", label: "Aktivitäten", description: "Aufgezeichnete Trainings mit Übungen und Sätzen, Verlinkungen, Ruhetage." },
  { key: "plans", label: "Pläne", description: "Trainingspläne samt Fortschritt, Abweichungen und bestätigten Ruhetagen." },
  { key: "posts", label: "Beiträge", description: "Beiträge mit Fotos, eigene Kommentare, Likes, Reposts und Markierungen." },
  { key: "stories", label: "Storys", description: "Storys mit Fotos, Highlights, eigene Story-Likes und -Aufrufe." },
  { key: "social", label: "Follower und Gefolgte", description: "Follower, Gefolgte, Anfragen, eigene Blockierungen und „Verbergen vor“." },
  { key: "notifications", label: "Benachrichtigungen", description: "Alle Benachrichtigungen der Person." },
  {
    key: "surveys",
    label: "Umfragen",
    description: "Teilnahmen und gesehene oder ausgeblendete Umfragekarten. Die anonymen Antworten und die Umfragen selbst bleiben.",
  },
  { key: "other", label: "Sonstiges", description: "Abgegebene Meldungen werden anonym, Einstellungen zurück auf Standard." },
];

export const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);

export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/** Names of the numbers inside a category (see reset_user_categories in schema.sql). */
export const COUNT_LABELS: Record<string, string> = {
  conversations: "Unterhaltungen",
  messages: "Nachrichten",
  memberships: "Mitgliedschaften",
  conversations_lost: "Beendete Unterhaltungen",
  workouts: "Trainings",
  sets: "Sätze",
  links: "Verlinkungen",
  rest_days: "Ruhetage",
  plans: "Pläne",
  rounds: "Durchläufe",
  deviations: "Abweichungen",
  planned_rest_days: "Geplante Ruhetage",
  adoptions: "Übernahmen",
  posts: "Beiträge",
  photos: "Fotos",
  comments: "Kommentare",
  likes: "Likes",
  reposts: "Reposts",
  tags: "Markierungen",
  stories: "Storys",
  highlights: "Highlights",
  views: "Aufrufe",
  following: "Gefolgte",
  followers: "Follower",
  requests: "Anfragen",
  blocks: "Blockierungen",
  hidden_from: "Verborgen vor",
  notifications: "Benachrichtigungen",
  reports_as_reporter: "Meldungen (anonymisiert)",
  participations: "Umfrage-Teilnahmen",
  item_views: "Gesehene oder ausgeblendete Umfragekarten",
  settings: "Einstellungen",
  account: "Konto",
};

export const PHRASE = "NEUSTART";
export const MAX_TARGETS = 500;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const SUBJECT_MAX = 150;
export const MESSAGE_MAX = 5000;

// ------------------------------------------------------------------ selection

export type Candidate = {
  userId: string;
  username: string;
  displayName: string;
  accountStatus: string;
  createdAt: string;
  /** 'self' | 'staff' | 'protected', or null. */
  protection: string | null;
  /** 'suspended' | 'banned' | 'deleting' | 'open_reports' | 'quarantine' */
  flags: string[];
};

export const PROTECTION_LABELS: Record<string, string> = {
  self: "Eigenes Konto",
  staff: "Moderator oder Admin",
  protected: "Geschützt (reset-config.sql)",
};

export const FLAG_LABELS: Record<string, string> = {
  suspended: "Gesperrt",
  banned: "Gebannt",
  deleting: "Wird gelöscht",
  open_reports: "Offene Meldungen",
  quarantine: "Inhalte in Quarantäne",
};

export type Selectability =
  | { kind: "selectable" }
  | { kind: "needs-flag-confirmation" }
  | { kind: "locked"; reason: string };

/** Whether a person can be ticked: protected never, flagged only after the extra confirmation. */
export function selectability(candidate: Candidate, mode: ResetMode, includeFlagged: boolean): Selectability {
  if (candidate.protection !== null) {
    return { kind: "locked", reason: PROTECTION_LABELS[candidate.protection] ?? "Geschützt" };
  }
  if (candidate.accountStatus === "deleting" && mode !== "full") {
    return { kind: "locked", reason: "Wird gelöscht: nur bei „Konten komplett löschen“ wählbar" };
  }
  if (candidate.flags.length > 0 && !includeFlagged) return { kind: "needs-flag-confirmation" };
  return { kind: "selectable" };
}

export function isFlagged(candidate: Candidate): boolean {
  return candidate.flags.length > 0;
}

/** Ticks or unticks one person; people who may not be selected are never added. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  candidate: Candidate,
  mode: ResetMode,
  includeFlagged: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(candidate.userId)) {
    next.delete(candidate.userId);
    return next;
  }
  if (selectability(candidate, mode, includeFlagged).kind === "selectable") next.add(candidate.userId);
  return next;
}

/**
 * "Alle ausser geschützte auswählen": adds every selectable person of the list (flagged ones only
 * after the extra confirmation), at most MAX_TARGETS in total.
 */
export function selectAllExceptProtected(
  selected: ReadonlySet<string>,
  candidates: readonly Candidate[],
  mode: ResetMode,
  includeFlagged: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  for (const candidate of candidates) {
    if (next.size >= MAX_TARGETS) break;
    if (selectability(candidate, mode, includeFlagged).kind === "selectable") next.add(candidate.userId);
  }
  return next;
}

/** Drops people that are no longer selectable (e.g. after switching the mode or the flag option). */
export function pruneSelection(
  selected: ReadonlySet<string>,
  known: ReadonlyMap<string, Candidate>,
  mode: ResetMode,
  includeFlagged: boolean,
): ReadonlySet<string> {
  const next = new Set<string>();
  for (const id of selected) {
    const candidate = known.get(id);
    if (candidate === undefined || selectability(candidate, mode, includeFlagged).kind === "selectable") next.add(id);
  }
  return next;
}

// ------------------------------------------------------------------ confirmation

/** The word must match exactly (case and spaces included). */
export function phraseMatches(input: string): boolean {
  return input === PHRASE;
}

export function isTotpCode(input: string): boolean {
  return /^\d{6}$/.test(input.replace(/\s/g, ""));
}

// ------------------------------------------------------------------ mail text

/** "Beiträge, Storys und Chats" in the order of CATEGORIES. */
export function categoryListText(categories: readonly string[]): string {
  const labels = CATEGORIES.filter((c) => categories.includes(c.key)).map((c) => c.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]}`;
}

export const PLACEHOLDERS = ["{{kategorien}}", "{{begruendung}}"] as const;

export const DEFAULT_SUBJECT = "PeakPic: Daten in deinem Konto wurden gelöscht";
export const DEFAULT_MESSAGE =
  "Hallo,\n\nwir haben in deinem PeakPic-Konto folgende Daten gelöscht: {{kategorien}}.\n\nGrund: {{begruendung}}";

/** Replaces the placeholders; everything else stays as written (plain text, never HTML). */
export function renderMessage(template: string, values: { categories: readonly string[]; reason: string; mode: ResetMode }): string {
  const what = values.mode === "full" ? "dein Konto mit allen Daten" : categoryListText(values.categories);
  return template.replaceAll("{{kategorien}}", what).replaceAll("{{begruendung}}", values.reason.trim());
}

/** Placeholders that are not known (typos like {{kategorie}}). */
export function unknownPlaceholders(template: string): string[] {
  const found = template.match(/\{\{[^}]*\}\}/g) ?? [];
  return [...new Set(found.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
}

// ------------------------------------------------------------------ numbers of the dry run

export type Counts = Record<string, Record<string, number>>;

/** Reads a counts object from the database ({category: {what: n}}); anything else is dropped. */
export function toCounts(value: unknown): Counts {
  const result: Counts = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  for (const [category, inner] of Object.entries(value)) {
    if (typeof inner !== "object" || inner === null || Array.isArray(inner)) continue;
    const numbers: Record<string, number> = {};
    for (const [key, n] of Object.entries(inner)) {
      const parsed = typeof n === "number" ? n : typeof n === "string" ? Number(n) : Number.NaN;
      if (Number.isFinite(parsed)) numbers[key] = parsed;
    }
    result[category] = numbers;
  }
  return result;
}

export function categoryTotal(counts: Counts, category: string): number {
  return Object.values(counts[category] ?? {}).reduce((sum, n) => sum + n, 0);
}

export function countsTotal(counts: Counts): number {
  return Object.keys(counts).reduce((sum, category) => sum + categoryTotal(counts, category), 0);
}

export function sumCounts(list: readonly Counts[]): Counts {
  const result: Counts = {};
  for (const counts of list) {
    for (const [category, inner] of Object.entries(counts)) {
      const target = (result[category] ??= {});
      for (const [key, n] of Object.entries(inner)) target[key] = (target[key] ?? 0) + n;
    }
  }
  return result;
}

// ------------------------------------------------------------------ wizard

export type WizardStep = "scope" | "users" | "preview" | "message" | "confirm" | "run" | "result";

export const WIZARD_STEPS: readonly { step: WizardStep; label: string }[] = [
  { step: "scope", label: "Umfang" },
  { step: "users", label: "Nutzer" },
  { step: "preview", label: "Vorschau" },
  { step: "message", label: "Begründung" },
  { step: "confirm", label: "Bestätigung" },
  { step: "run", label: "Ausführung" },
  { step: "result", label: "Ergebnis" },
];

export type JobStatus = "draft" | "confirmed" | "running" | "done" | "failed" | "cancelled";

export type WizardInput = {
  mode: ResetMode | null;
  categories: readonly string[];
  allowFull: boolean;
  selectedCount: number;
  /** A dry run newer than the last change of scope or people. */
  previewFresh: boolean;
  reason: string;
  subject: string;
  message: string;
  backupConfirmed: boolean;
  phrase: string;
  totpCode: string;
};

/** Why the step can't be left forward yet, or null. */
export function blockerFor(step: WizardStep, input: WizardInput): string | null {
  switch (step) {
    case "scope":
      if (input.mode === null) return "Bitte den Umfang wählen.";
      if (input.mode === "full" && !input.allowFull) return "Komplettes Löschen ist ausgeschaltet (allow_full_reset).";
      if (input.mode === "categories" && input.categories.length === 0) return "Mindestens eine Kategorie wählen.";
      return null;
    case "users":
      if (input.selectedCount === 0) return "Mindestens eine Person auswählen.";
      if (input.selectedCount > MAX_TARGETS) return `Höchstens ${MAX_TARGETS} Personen pro Auftrag.`;
      return null;
    case "preview":
      return input.previewFresh ? null : "Zuerst den Trockenlauf ausführen.";
    case "message": {
      const reason = input.reason.trim();
      if (reason.length < REASON_MIN) return `Die Begründung braucht mindestens ${REASON_MIN} Zeichen.`;
      if (reason.length > REASON_MAX) return `Die Begründung darf höchstens ${REASON_MAX} Zeichen haben.`;
      if (input.subject.trim() === "") return "Bitte einen Betreff angeben.";
      if (input.subject.length > SUBJECT_MAX || /[\r\n]/.test(input.subject)) return `Betreff: eine Zeile, höchstens ${SUBJECT_MAX} Zeichen.`;
      if (input.message.trim() === "") return "Bitte einen Text für die E-Mail angeben.";
      if (input.message.length > MESSAGE_MAX) return `Der Text darf höchstens ${MESSAGE_MAX} Zeichen haben.`;
      const unknown = unknownPlaceholders(`${input.subject} ${input.message}`);
      if (unknown.length > 0) return `Unbekannter Platzhalter: ${unknown.join(", ")}`;
      return null;
    }
    case "confirm":
      if (!input.backupConfirmed) return "Bitte bestätigen, dass eine Sicherung vorliegt.";
      if (!phraseMatches(input.phrase)) return `Bitte genau „${PHRASE}“ eingeben.`;
      if (!isTotpCode(input.totpCode)) return "Bitte den aktuellen 6-stelligen Code eingeben.";
      return null;
    case "run":
    case "result":
      return null;
  }
}

/** The step after this one while the job is still a draft (null after "confirm": confirming is its own action). */
export function nextStep(step: WizardStep): WizardStep | null {
  const order: WizardStep[] = ["scope", "users", "preview", "message", "confirm"];
  const index = order.indexOf(step);
  return index >= 0 && index < order.length - 1 ? (order[index + 1] ?? null) : null;
}

/** "Zurück": only while the job is a draft; never from the run or the result. */
export function previousStep(step: WizardStep, status: JobStatus | null): WizardStep | null {
  if (status !== null && status !== "draft") return null;
  const order: WizardStep[] = ["scope", "users", "preview", "message", "confirm"];
  const index = order.indexOf(step);
  return index > 0 ? (order[index - 1] ?? null) : null;
}

/** Where an existing job opens. */
export function stepForJob(status: JobStatus, previewed: boolean): WizardStep {
  if (status === "draft") return previewed ? "preview" : "users";
  if (status === "confirmed" || status === "running" || status === "failed") return "run";
  return "result";
}

/** Run actions that are allowed in a state. */
export function runActions(status: JobStatus): { start: boolean; resume: boolean; cancel: boolean } {
  return {
    start: status === "confirmed",
    resume: status === "running" || status === "failed",
    cancel: status === "draft" || status === "confirmed",
  };
}
