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
