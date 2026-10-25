// Pure logic of the survey pages (unit tested in src/lib/__tests__/surveyAdmin.test.ts): the
// editor's steps and required fields, the conversion to the server's format, durations, list
// filters, rates, chart rows and exports with aggregated numbers only. The database checks
// everything again.

import { SURVEY_LIMITS, SURVEY_STATE_LABELS, questionProblem, type QuestionKind, type SurveyState } from "./surveys";

// ------------------------------------------------------------------ the draft in the editor

export type ScaleChoice = "1-5" | "1-10" | "0-10";

export type DraftQuestion = {
  /** Only for React keys and ordering in the editor. */
  key: string;
  kind: QuestionKind;
  prompt: string;
  required: boolean;
  options: string[];
  maxChoices: number;
  scale: ScaleChoice;
  textMax: number;
};

export type SurveyDraft = {
  id: string | null;
  title: string;
  topic: string;
  startMode: "now" | "scheduled";
  /** "YYYY-MM-DDTHH:mm" in the browser's time (datetime-local), or "". */
  startsAt: string;
  endsAt: string;
  pinUntilAnswered: boolean;
  allowText: boolean;
  feedDays: number;
  /** null: "unbegrenzt". */
  profileDays: number | null;
  questions: DraftQuestion[];
};

let keySeed = 0;
export function newQuestion(kind: QuestionKind = "single"): DraftQuestion {
  keySeed += 1;
  return { key: `q${Date.now().toString(36)}${keySeed}`, kind, prompt: "", required: true, options: ["", ""], maxChoices: 2, scale: "1-5", textMax: 280 };
}

export function emptyDraft(): SurveyDraft {
  return {
    id: null,
    title: "",
    topic: "",
    startMode: "now",
    startsAt: "",
    endsAt: "",
    pinUntilAnswered: false,
    allowText: false,
    feedDays: 7,
    profileDays: 90,
    questions: [newQuestion("single")],
  };
}

const SCALE_BOUNDS: Record<ScaleChoice, [number, number]> = { "1-5": [1, 5], "1-10": [1, 10], "0-10": [0, 10] };

/** "YYYY-MM-DDTHH:mm" (local) from an ISO time; "" for none. */
export function toLocalInput(iso: string | null): string {
  if (iso === null || iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO time from a datetime-local value (the browser's time zone); null for empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** One question as the server takes it (null fields for the other kinds). */
export function questionToServer(q: DraftQuestion): Record<string, unknown> {
  const choice = q.kind === "single" || q.kind === "multiple";
  const [min, max] = SCALE_BOUNDS[q.scale];
  return {
    kind: q.kind,
    prompt: q.prompt.trim(),
    required: q.required,
    options: choice ? q.options.map((o) => o.trim()) : null,
    max_choices: q.kind === "multiple" ? q.maxChoices : null,
    scale_min: q.kind === "scale" ? min : null,
    scale_max: q.kind === "scale" ? max : null,
    text_max: q.kind === "text" ? q.textMax : null,
  };
}

/** The draft as admin_survey_save takes it. */
export function draftToServer(draft: SurveyDraft): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    topic: draft.topic.trim(),
    starts_at: draft.startMode === "now" ? null : fromLocalInput(draft.startsAt),
    ends_at: fromLocalInput(draft.endsAt),
    pin_until_answered: draft.pinUntilAnswered,
    allow_text: draft.allowText,
    feed_days: draft.feedDays,
    profile_days: draft.profileDays,
    questions: draft.questions.map(questionToServer),
  };
}

function scaleOf(min: unknown, max: unknown): ScaleChoice {
  return min === 0 ? "0-10" : max === 10 ? "1-10" : "1-5";
}

/** A survey from admin_survey_get as editor draft. */
export function draftFromServer(s: Record<string, unknown>): SurveyDraft {
  const questions = Array.isArray(s.questions) ? (s.questions as Record<string, unknown>[]) : [];
  return {
    id: typeof s.id === "string" ? s.id : null,
    title: typeof s.title === "string" ? s.title : "",
    topic: typeof s.topic === "string" ? s.topic : "",
    startMode: typeof s.starts_at === "string" ? "scheduled" : "now",
    startsAt: toLocalInput(typeof s.starts_at === "string" ? s.starts_at : null),
    endsAt: toLocalInput(typeof s.ends_at === "string" ? s.ends_at : null),
    pinUntilAnswered: s.pin_until_answered === true,
    allowText: s.allow_text === true,
    feedDays: typeof s.feed_days === "number" ? s.feed_days : 7,
    profileDays: typeof s.profile_days === "number" ? s.profile_days : null,
    questions: questions.map((q) => ({
      ...newQuestion(q.kind as QuestionKind),
      prompt: typeof q.prompt === "string" ? q.prompt : "",
      required: q.required === true,
      options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : ["", ""],
      maxChoices: typeof q.max_choices === "number" ? q.max_choices : 2,
      scale: scaleOf(q.scale_min, q.scale_max),
      textMax: typeof q.text_max === "number" ? q.text_max : 280,
    })),
  };
}

/** "Kopie von …" as a new draft: no id, no dates (images stay with the original). */
export function duplicateDraft(draft: SurveyDraft): SurveyDraft {
  return {
    ...draft,
    id: null,
    title: `Kopie von ${draft.title}`.slice(0, SURVEY_LIMITS.title[1]),
    startMode: "now",
    startsAt: "",
    endsAt: "",
    questions: draft.questions.map((q) => ({ ...q, key: newQuestion(q.kind).key, options: [...q.options] })),
  };
}

// ------------------------------------------------------------------ steps and required fields

export const EDITOR_STEPS = ["basics", "media", "questions", "display", "preview", "publish"] as const;
export type EditorStep = (typeof EDITOR_STEPS)[number];
export const STEP_LABELS: Record<EditorStep, string> = {
  basics: "Grunddaten",
  media: "Medien",
  questions: "Fragen",
  display: "Anzeige im Feed",
  preview: "Vorschau",
  publish: "Veröffentlichen",
};

const QUESTION_TEXTS: Record<string, string> = {
  invalid_prompt: "Frage mit 3 bis 200 Zeichen",
  invalid_options: "2 bis 10 Antworten mit je 1 bis 80 Zeichen",
  duplicate_options: "zwei gleiche Antworten",
  invalid_max_choices: "Anzahl Antworten zum Ankreuzen passt nicht",
  invalid_scale: "Skala wählen",
  invalid_text_max: "Freitext 20 bis 280 Zeichen",
  text_not_allowed: "Freitext ist nicht erlaubt (Haken unter Fragen setzen)",
  invalid_kind: "Fragetyp wählen",
  invalid_required: "Pflicht angeben",
};

/** Length in days and hours, or why the period doesn't fit (1 hour to 90 days). */
export function durationInfo(startIso: string | null, endIso: string | null, now: Date): { text: string; problem: string | null } {
  if (endIso === null) return { text: "", problem: "Bitte ein Ende wählen." };
  const start = startIso === null ? now.getTime() : Date.parse(startIso);
  const end = Date.parse(endIso);
  const ms = end - start;
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  const text = ms <= 0 ? "" : days > 0 ? `Dauer: ${days} ${days === 1 ? "Tag" : "Tage"}${hours % 24 > 0 ? `, ${hours % 24} Std.` : ""}` : `Dauer: ${hours} Std.`;
  if (ms < 3600000) return { text, problem: "Die Umfrage muss mindestens 1 Stunde laufen." };
  if (ms > SURVEY_LIMITS.maxDays * 86400000) return { text, problem: "Höchstens 90 Tage." };
  return { text, problem: null };
}

/** What still has to be done in a step (empty: ready). Same limits as the server. */
export function stepProblems(draft: SurveyDraft, step: EditorStep, now: Date, published = false): string[] {
  const problems: string[] = [];
  if (step === "basics" || step === "publish") {
    const title = [...draft.title.trim()].length;
    const topic = [...draft.topic.trim()].length;
    if (title < SURVEY_LIMITS.title[0] || title > SURVEY_LIMITS.title[1]) problems.push("Titel mit 3 bis 120 Zeichen.");
    if (topic < SURVEY_LIMITS.topic[0] || topic > SURVEY_LIMITS.topic[1]) problems.push("„Worum geht es“ mit 10 bis 1000 Zeichen.");
    if (!published) {
      const start = draft.startMode === "now" ? null : fromLocalInput(draft.startsAt);
      if (draft.startMode === "scheduled" && start === null) problems.push("Bitte einen Start wählen.");
      else if (start !== null && Date.parse(start) < now.getTime() - 5 * 60000) problems.push("Der Start liegt in der Vergangenheit.");
      const duration = durationInfo(start, fromLocalInput(draft.endsAt), now);
      if (duration.problem !== null) problems.push(duration.problem);
    }
  }
  if (step === "questions" || step === "publish") {
    if (draft.questions.length === 0) problems.push("Mindestens eine Frage.");
    if (draft.questions.length > SURVEY_LIMITS.questions) problems.push("Höchstens 10 Fragen.");
    draft.questions.forEach((q, i) => {
      const s = questionToServer(q);
      const code = questionProblem(
        {
          kind: q.kind,
          prompt: q.prompt,
          required: q.required,
          options: s.options as string[] | null,
          maxChoices: s.max_choices as number | null,
          scaleMin: s.scale_min as number | null,
          scaleMax: s.scale_max as number | null,
          textMax: s.text_max as number | null,
        },
        draft.allowText,
      );
      if (code !== null) problems.push(`Frage ${i + 1}: ${QUESTION_TEXTS[code] ?? code}.`);
    });
  }
  if (step === "display" || step === "publish") {
    if (!Number.isInteger(draft.feedDays) || draft.feedDays < 1 || draft.feedDays > 90) problems.push("Im Feed 1 bis 90 Tage.");
    if (draft.profileDays !== null && (!Number.isInteger(draft.profileDays) || draft.profileDays < 1 || draft.profileDays > 3650)) {
      problems.push("Im Profil 1 bis 3650 Tage oder unbegrenzt.");
    }
  }
  return problems;
}

export type EditorState = { step: number; furthest: number };
export type EditorAction = { type: "next" } | { type: "back" } | { type: "goto"; step: number };

/**
 * The wizard: "Weiter" only when the step has no problems, "Zurück" always, jumping only to
 * steps reached before (and only forward if every step on the way is ready).
 */
export function editorReducer(state: EditorState, action: EditorAction, draft: SurveyDraft, now: Date, published = false): EditorState {
  const ready = (i: number) => stepProblems(draft, EDITOR_STEPS[i] ?? "publish", now, published).length === 0;
  switch (action.type) {
    case "back":
      return { ...state, step: Math.max(0, state.step - 1) };
    case "next": {
      if (state.step >= EDITOR_STEPS.length - 1 || !ready(state.step)) return state;
      const step = state.step + 1;
      return { step, furthest: Math.max(state.furthest, step) };
    }
    case "goto": {
      const target = Math.max(0, Math.min(EDITOR_STEPS.length - 1, action.step));
      if (target > state.furthest) return state;
      for (let i = state.step; i < target; i += 1) if (!ready(i)) return state;
      return { ...state, step: target };
    }
  }
}

// ------------------------------------------------------------------ list

export type SurveyListRow = {
  id: string;
  title: string;
  state: SurveyState;
  startsAt: string | null;
  endsAt: string | null;
  responses: number;
  participants: number;
  eligibleStart: number | null;
  locked: boolean;
};

export function filterSurveys(rows: readonly SurveyListRow[], state: SurveyState | "all", query: string): SurveyListRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (state === "all" || r.state === state) && (q === "" || r.title.toLowerCase().includes(q)));
}

/** Share 0..1, or null without a basis. */
export function rate(part: number, whole: number | null): number | null {
  if (whole === null || whole <= 0) return null;
  return Math.min(1, part / whole);
}

export function percent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 1000) / 10} %`;
}

export function stateLabel(state: SurveyState): string {
  return SURVEY_STATE_LABELS[state];
}

/** Which actions a survey in the list offers. */
export function actionsFor(row: Pick<SurveyListRow, "state" | "locked">): { edit: boolean; publish: boolean; extend: boolean; cancel: boolean; results: boolean; remove: boolean } {
  const running = row.state === "scheduled" || row.state === "active";
  return {
    edit: row.state === "draft" || (running && !row.locked),
    publish: row.state === "draft",
    extend: running,
    cancel: running,
    results: row.state !== "draft",
    remove: row.state === "draft",
  };
}

// ------------------------------------------------------------------ evaluation

export type QuestionStats = {
  questionId: string;
  kind: QuestionKind;
  prompt: string;
  answered: number;
  distribution: { label: string; count: number }[];
  mean: number | null;
  median: number | null;
  nps: number | null;
  texts: { responseId: string; text: string; hidden: boolean }[];
};

export type SurveyResults = {
  title: string;
  state: SurveyState;
  participants: number;
  responses: number;
  eligibleStart: number | null;
  eligibleEnd: number | null;
  started: number;
  reach: number;
  perDay: { day: string; count: number }[];
  hours: number[] | null;
  questions: QuestionStats[];
};

export const MIN_ANSWERS = SURVEY_LIMITS.minAnswersToPublish;

/** Bars for a question (label and count, the percent is shown by the chart). */
export function chartRows(q: QuestionStats): { label: string; value: number }[] {
  return q.distribution.map((d) => ({ label: d.label, value: d.count }));
}

/** Percent of answers for the table (one decimal). */
export function shareOf(count: number, answered: number): number {
  return answered > 0 ? Math.round((count / answered) * 1000) / 10 : 0;
}

/** Why the results can't be published yet, or null. */
export function publishBlocker(results: Pick<SurveyResults, "responses" | "state">, keptAfterCancel: boolean): string | null {
  if (results.responses < MIN_ANSWERS) return `Erst ab ${MIN_ANSWERS} Antworten (bisher ${results.responses}).`;
  if (!(results.state === "closed" || (results.state === "cancelled" && keptAfterCancel))) return "Erst nach dem Ende der Umfrage.";
  return null;
}

/**
 * The export: only aggregated numbers (totals and per question the distribution, mean, median,
 * NPS). No free text, no single answers, no days or hours.
 */
export function exportSummary(results: SurveyResults): Record<string, unknown> {
  return {
    title: results.title,
    state: results.state,
    participants: results.participants,
    participationRateAtStart: rate(results.participants, results.eligibleStart),
    participationRateAtEnd: rate(results.participants, results.eligibleEnd),
    completionRate: rate(results.participants, results.started),
    questions: results.questions.map((q) => ({
      prompt: q.prompt,
      kind: q.kind,
      answered: q.answered,
      distribution: q.kind === "text" ? [] : q.distribution.map((d) => ({ label: d.label, count: d.count, percent: shareOf(d.count, q.answered) })),
      mean: q.mean,
      median: q.median,
      nps: q.nps,
    })),
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Formula injection: cells starting with = + - @ are prefixed so spreadsheets show them as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The same aggregated numbers as CSV (semicolon, one row per answer option). */
export function exportCsv(results: SurveyResults): string {
  const rows: unknown[][] = [["Frage", "Antwort", "Anzahl", "Anteil %", "Mittelwert", "Median", "NPS"]];
  for (const q of results.questions) {
    if (q.kind === "text") {
      rows.push([q.prompt, "(Freitext, nicht exportiert)", q.answered, "", "", "", ""]);
      continue;
    }
    for (const d of q.distribution) rows.push([q.prompt, d.label, d.count, shareOf(d.count, q.answered), q.mean, q.median, q.nps]);
  }
  rows.push(["Teilnahmen", "", results.participants, "", "", "", ""]);
  return rows.map((r) => r.map(csvCell).join(";")).join("\n");
}

// ------------------------------------------------------------------ images

/** Size an image is scaled to before the upload (longest side at most 1600 pixels). */
export function resizeTarget(width: number, height: number, max = 1600): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
