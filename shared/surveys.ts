// Surveys ("Umfragen"): limits, the state from the timestamps, and the checks of questions and
// answers. Pure, shared by the app and the dashboard; the database enforces the same rules in
// public.survey_question_problem() and public.survey_answers_problem() (a test compares both).

export const SURVEY_LIMITS = {
  title: [3, 120],
  topic: [10, 1000],
  questions: 10,
  prompt: [3, 200],
  options: [2, 10],
  optionText: [1, 80],
  textMax: [20, 280],
  images: 4,
  logos: 3,
  altText: [1, 140],
  /** Shortest and longest run. */
  minHours: 1,
  maxDays: 90,
  feedDays: [1, 90],
  profileDays: [1, 3650],
  cancelReason: [10, 500],
  /** Largest answers object (characters of its JSON). */
  answersChars: 10000,
  /** Fewer answers: results are shown with a warning and can't be published. */
  minAnswersToPublish: 5,
} as const;

export const SURVEY_DEFAULTS = { feedDays: 7, profileDays: 90 } as const;

/** The allowed scales (from, to). */
export const SCALES: readonly (readonly [number, number])[] = [
  [1, 5],
  [1, 10],
  [0, 10],
];

export const QUESTION_KINDS = ["single", "multiple", "scale", "yes_no", "text"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  single: "Eine Antwort",
  multiple: "Mehrere Antworten",
  scale: "Skala",
  yes_no: "Ja oder Nein",
  text: "Freitext",
};

export type SurveyQuestion = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  required: boolean;
  options: string[] | null;
  maxChoices: number | null;
  scaleMin: number | null;
  scaleMax: number | null;
  textMax: number | null;
};

export type SurveyState = "draft" | "scheduled" | "active" | "closed" | "cancelled";

export const SURVEY_STATE_LABELS: Record<SurveyState, string> = {
  draft: "Entwurf",
  scheduled: "Geplant",
  active: "Aktiv",
  closed: "Beendet",
  cancelled: "Abgebrochen",
};

type Times = { publishedAt: string | null; startsAt: string | null; endsAt: string | null; cancelledAt: string | null };

/**
 * The state at `now`, from the timestamps only (no background job): active from the start
 * (inclusive) until the end (exclusive), unless cancelled. Same as public.survey_state().
 */
export function surveyState(s: Times, now: Date): SurveyState {
  if (s.cancelledAt !== null) return "cancelled";
  if (s.publishedAt === null || s.startsAt === null || s.endsAt === null) return "draft";
  const t = now.getTime();
  if (t < Date.parse(s.startsAt)) return "scheduled";
  if (t < Date.parse(s.endsAt)) return "active";
  return "closed";
}

const inRange = (n: number, [min, max]: readonly [number, number]) => n >= min && n <= max;
/** Trims spaces, tabs and line breaks (exactly what btrim(x, E' \t\r\n') does in the database). */
export const trimText = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
/** Characters (code points, like char_length) after trimming. */
const len = (s: string) => [...trimText(s)].length;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * Why a question can't be saved (a code), or null. Choices: 2 to 10 different options of 1 to 80
 * characters, "multiple" with 1 to n choices allowed; scales 1-5, 1-10 or 0-10; free text 20 to
 * 280 characters and only when the survey allows free text; other kinds carry no extra fields.
 */
export function questionProblem(q: Omit<SurveyQuestion, "id">, allowText: boolean): string | null {
  if (!(QUESTION_KINDS as readonly string[]).includes(q.kind)) return "invalid_kind";
  if (typeof q.prompt !== "string" || !inRange(len(q.prompt), SURVEY_LIMITS.prompt)) return "invalid_prompt";
  if (typeof q.required !== "boolean") return "invalid_required";
  const choice = q.kind === "single" || q.kind === "multiple";
  if (choice) {
    const o = q.options;
    if (!Array.isArray(o) || !inRange(o.length, SURVEY_LIMITS.options)) return "invalid_options";
    if (!o.every((x) => typeof x === "string" && inRange(len(x), SURVEY_LIMITS.optionText))) return "invalid_options";
    if (new Set(o.map((x) => trimText(x).toLowerCase())).size !== o.length) return "duplicate_options";
  } else if (q.options !== null) return "invalid_options";
  if (q.kind === "multiple") {
    if (!isInt(q.maxChoices) || q.maxChoices < 1 || q.maxChoices > (q.options?.length ?? 0)) return "invalid_max_choices";
  } else if (q.maxChoices !== null) return "invalid_max_choices";
  if (q.kind === "scale") {
    if (!SCALES.some(([a, b]) => a === q.scaleMin && b === q.scaleMax)) return "invalid_scale";
  } else if (q.scaleMin !== null || q.scaleMax !== null) return "invalid_scale";
  if (q.kind === "text") {
    if (!allowText) return "text_not_allowed";
    if (!isInt(q.textMax) || !inRange(q.textMax, SURVEY_LIMITS.textMax)) return "invalid_text_max";
  } else if (q.textMax !== null) return "invalid_text_max";
  return null;
}

/** Whether one value fits its question (single: index, multiple: distinct indices, scale: whole number, yes/no, text). */
function valueFits(q: SurveyQuestion, v: unknown, allowText: boolean): boolean {
  switch (q.kind) {
    case "single":
      return isInt(v) && v >= 0 && v < (q.options?.length ?? 0);
    case "multiple":
      return (
        Array.isArray(v) &&
        v.length >= 1 &&
        v.length <= (q.maxChoices ?? 0) &&
        v.every((x) => isInt(x) && x >= 0 && x < (q.options?.length ?? 0)) &&
        new Set(v).size === v.length
      );
    case "scale":
      return isInt(v) && v >= (q.scaleMin ?? 0) && v <= (q.scaleMax ?? 0);
    case "yes_no":
      return typeof v === "boolean";
    case "text":
      return allowText && typeof v === "string" && !v.includes("\u0000") && len(v) >= 1 && len(v) <= (q.textMax ?? 0);
  }
}

/**
 * Why answers can't be sent (a code), or null: an object of question id -> value, no unknown
 * questions, every required question answered, every value within its question's limits.
 * Optional questions may be missing or null. Same as public.survey_answers_problem().
 */
export function answersProblem(questions: readonly SurveyQuestion[], answers: unknown, allowText: boolean): string | null {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return "invalid_answers";
  try {
    if (JSON.stringify(answers).length > SURVEY_LIMITS.answersChars) return "invalid_answers";
  } catch {
    return "invalid_answers";
  }
  const values = answers as Record<string, unknown>;
  const ids = new Set(questions.map((q) => q.id));
  if (Object.keys(values).some((k) => !ids.has(k))) return "invalid_answers";
  for (const q of questions) {
    const v = values[q.id];
    if (v === undefined || v === null) {
      if (q.required) return "required_missing";
      continue;
    }
    if (!valueFits(q, v, allowText)) return "invalid_answers";
  }
  return null;
}

/** The value sent for a free-text answer: trimmed. Other values unchanged. */
export function cleanAnswers(questions: readonly SurveyQuestion[], answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of questions) {
    const v = answers[q.id];
    if (v === undefined || v === null) continue;
    out[q.id] = q.kind === "text" && typeof v === "string" ? trimText(v) : v;
  }
  return out;
}

// ------------------------------------------------------------------ official posts as the app reads them

export type SurveyMedia = {
  kind: "image" | "logo";
  /** Storage path in the bucket survey-media (images). */
  path: string | null;
  /** Logo spec from the logo library (checked again before drawing). */
  logo: unknown;
  altText: string;
  position: number;
  width: number | null;
  height: number | null;
};

/** One question of a published results summary: only the numbers and texts chosen for it. */
export type SnapshotQuestion = {
  prompt: string;
  kind: QuestionKind;
  /** How many answered this question. */
  answered: number;
  /** Distribution (choices, yes/no, scale values). */
  options: { label: string; count: number; percent: number }[];
  mean: number | null;
  median: number | null;
  /** Net Promoter Score (scale 0-10 only). */
  nps: number | null;
  /** Free text answers chosen one by one by an admin. */
  quotes: string[];
};

/** The fixed snapshot of a results post (written once by the dashboard, never computed live). */
export type ResultsSnapshot = {
  version: 1;
  title: string;
  /** "Fazit", up to 600 characters. */
  conclusion: string;
  participants: number;
  /** Participants / eligible accounts at the start (0..1), if chosen. */
  participationRate: number | null;
  closedAt: string | null;
  questions: SnapshotQuestion[];
  media: SurveyMedia[];
};

export type OfficialItem = {
  itemId: string;
  kind: "survey" | "results";
  surveyId: string;
  title: string;
  topic: string | null;
  state: SurveyState;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string;
  feedUntil: string;
  profileUntil: string | null;
  pinUntilAnswered: boolean;
  answered: boolean;
  questionCount: number;
  media: SurveyMedia[];
  snapshot: ResultsSnapshot | null;
  /** The account has seen the card for at least a second. */
  seen: boolean;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && [...v].length <= max ? v : null);
const num = (v: unknown, min = -Infinity, max = Infinity): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
const STATES: readonly SurveyState[] = ["draft", "scheduled", "active", "closed", "cancelled"];
const MEDIA_PATH = /^survey\/[0-9a-f-]{36}\/[a-z]+-[0-9a-f-]{36}\.(png|jpg|webp)$/;

function list<T>(v: unknown, parse: (x: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    const p = parse(x);
    if (p !== null) out.push(p);
  }
  return out;
}

/** A media entry (server JSON: snake_case); null when it doesn't fit. */
export function parseMedia(value: unknown): SurveyMedia | null {
  const r = rec(value);
  if (r === null || (r.kind !== "image" && r.kind !== "logo")) return null;
  const altText = str(r.alt_text, 140);
  if (altText === null || trimText(altText) === "") return null;
  const path = r.kind === "image" ? str(r.path, 200) : null;
  if (r.kind === "image" && (path === null || !MEDIA_PATH.test(path))) return null;
  return {
    kind: r.kind,
    path,
    logo: r.kind === "logo" ? r.logo : null,
    altText,
    position: num(r.position, 0, 6) ?? 0,
    width: num(r.width, 1, 1600),
    height: num(r.height, 1, 1600),
  };
}

function parseOption(o: unknown): { label: string; count: number; percent: number } | null {
  const x = rec(o);
  if (x === null) return null;
  const label = str(x.label, 80);
  const count = num(x.count, 0);
  const percent = num(x.percent, 0, 100);
  return label === null || count === null || percent === null ? null : { label, count, percent };
}

function parseSnapshotQuestion(value: unknown): SnapshotQuestion | null {
  const r = rec(value);
  if (r === null) return null;
  const prompt = str(r.prompt, 200);
  const kind = r.kind;
  if (prompt === null || typeof kind !== "string" || !(QUESTION_KINDS as readonly string[]).includes(kind)) return null;
  return {
    prompt,
    kind: kind as QuestionKind,
    answered: num(r.answered, 0) ?? 0,
    options: list(r.options, parseOption, 11),
    mean: num(r.mean),
    median: num(r.median),
    nps: num(r.nps, -100, 100),
    quotes: list(r.quotes, (q) => str(q, 280), 20),
  };
}

/** The snapshot of a results post, checked; null when it is missing or broken (nothing is shown). */
export function parseSnapshot(value: unknown): ResultsSnapshot | null {
  const r = rec(value);
  if (r === null || r.version !== 1) return null;
  const title = str(r.title, 120);
  const conclusion = str(r.conclusion, 600);
  const participants = num(r.participants, 0);
  if (title === null || conclusion === null || participants === null) return null;
  return {
    version: 1,
    title,
    conclusion,
    participants,
    participationRate: num(r.participationRate, 0, 1),
    closedAt: iso(r.closedAt),
    questions: list(r.questions, parseSnapshotQuestion, SURVEY_LIMITS.questions),
    media: list(r.media, parseMedia, 7),
  };
}

/**
 * An official post from the server. Only the known fields are taken (anything else the answer
 * might contain is dropped); null when required fields are missing.
 */
export function parseOfficialItem(value: unknown): OfficialItem | null {
  const r = rec(value);
  if (r === null || (r.kind !== "survey" && r.kind !== "results")) return null;
  const itemId = str(r.item_id, 36);
  const surveyId = str(r.survey_id, 36);
  const title = str(r.title, 120);
  const publishedAt = iso(r.published_at);
  const feedUntil = iso(r.feed_until);
  const state = STATES.find((s) => s === r.state);
  if (itemId === null || surveyId === null || title === null || publishedAt === null || feedUntil === null || state === undefined) return null;
  const snapshot = r.kind === "results" ? parseSnapshot(r.snapshot) : null;
  if (r.kind === "results" && snapshot === null) return null;
  return {
    itemId,
    kind: r.kind,
    surveyId,
    title,
    topic: r.kind === "survey" ? str(r.topic, 1000) : null,
    state,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    publishedAt,
    feedUntil,
    profileUntil: iso(r.profile_until),
    pinUntilAnswered: r.pin_until_answered === true,
    answered: r.answered === true,
    questionCount: num(r.question_count, 0, SURVEY_LIMITS.questions) ?? 0,
    media: r.kind === "results" ? (snapshot?.media ?? []) : list(r.media, parseMedia, 7),
    snapshot,
    seen: r.seen === true,
  };
}

/** A survey for taking part (get_survey). */
export type SurveyForAnswering = {
  surveyId: string;
  title: string;
  topic: string;
  state: SurveyState;
  endsAt: string | null;
  allowText: boolean;
  answered: boolean;
  media: SurveyMedia[];
  questions: SurveyQuestion[];
};

function parseQuestion(value: unknown, allowText: boolean): SurveyQuestion | null {
  const x = rec(value);
  const id = x === null ? null : str(x.id, 36);
  if (x === null || id === null) return null;
  const question: SurveyQuestion = {
    id,
    kind: x.kind as QuestionKind,
    prompt: typeof x.prompt === "string" ? x.prompt : "",
    required: x.required === true,
    options: Array.isArray(x.options) ? x.options.filter((o): o is string => typeof o === "string") : null,
    maxChoices: num(x.max_choices),
    scaleMin: num(x.scale_min),
    scaleMax: num(x.scale_max),
    textMax: num(x.text_max),
  };
  // The same rules as the server: a question that doesn't fit is not shown at all.
  return questionProblem(question, allowText) === null ? question : null;
}

/** A survey for taking part, checked; null when it can't be shown. */
export function parseSurvey(value: unknown): SurveyForAnswering | null {
  const r = rec(value);
  if (r === null) return null;
  const surveyId = str(r.survey_id, 36);
  const title = str(r.title, 120);
  const topic = str(r.topic, 1000);
  const state = STATES.find((s) => s === r.state);
  if (surveyId === null || title === null || topic === null || state === undefined) return null;
  const allowText = r.allow_text === true;
  return {
    surveyId,
    title,
    topic,
    state,
    endsAt: iso(r.ends_at),
    allowText,
    answered: r.answered === true,
    media: list(r.media, parseMedia, 7),
    questions: list(r.questions, (q) => parseQuestion(q, allowText), SURVEY_LIMITS.questions),
  };
}

/** "noch 3 Tage", "noch 5 Stunden", "noch 20 Minuten", "endet gleich", "beendet". */
export function remainingText(endsAt: string | null, now: Date): string {
  if (endsAt === null) return "";
  const ms = Date.parse(endsAt) - now.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "beendet";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return days === 1 ? "noch 1 Tag" : `noch ${days} Tage`;
  if (hours >= 1) return hours === 1 ? "noch 1 Stunde" : `noch ${hours} Stunden`;
  if (minutes >= 1) return minutes === 1 ? "noch 1 Minute" : `noch ${minutes} Minuten`;
  return "endet gleich";
}
