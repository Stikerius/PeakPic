import { answersProblem, cleanAnswers, trimText, type SurveyQuestion } from "../../shared/surveys";

/** Answers while filling in: question id -> value (same shapes the server takes). */
export type Answers = Record<string, unknown>;

/** Whether a value counts as an answer (empty text and empty selections don't). */
export function hasAnswer(question: SurveyQuestion, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (question.kind === "multiple") return Array.isArray(value) && value.length > 0;
  if (question.kind === "text") return typeof value === "string" && trimText(value) !== "";
  return true;
}

/** "Weiter" is possible when the question is optional or answered, and the answer fits. */
export function canContinue(question: SurveyQuestion, value: unknown, allowText: boolean): boolean {
  if (!hasAnswer(question, value)) return !question.required;
  return answersProblem([question], { [question.id]: value }, allowText) === null;
}

/**
 * Tapping an option of a "multiple" question: adds or removes it; at the limit (max choices)
 * nothing more is added. Kept in the order of the options.
 */
export function toggleChoice(question: SurveyQuestion, value: unknown, index: number): number[] {
  const current = Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : [];
  if (current.includes(index)) return current.filter((v) => v !== index);
  if (current.length >= (question.maxChoices ?? 1)) return current;
  return [...current, index].sort((a, b) => a - b);
}

/** Something was entered (leaving then needs a confirmation). */
export function isDirty(questions: readonly SurveyQuestion[], answers: Answers): boolean {
  return questions.some((q) => hasAnswer(q, answers[q.id]));
}

/** What is sent: only real answers, free text trimmed. Null when something doesn't fit. */
export function answersToSend(questions: readonly SurveyQuestion[], answers: Answers, allowText: boolean): Answers | null {
  const real: Answers = {};
  for (const q of questions) if (hasAnswer(q, answers[q.id])) real[q.id] = answers[q.id];
  const cleaned = cleanAnswers(questions, real);
  return answersProblem(questions, cleaned, allowText) === null ? cleaned : null;
}

/** Why sending failed, as the screen needs it. */
export type SubmitFailure = "ended" | "already" | "invalid" | "network";

/**
 * ended: the survey ended or was cancelled meanwhile (nothing is sent, a plain message);
 * already: answered before (e.g. on another device); invalid: the server refused the answers;
 * network: anything else (the answers stay, "Erneut versuchen").
 */
export function classifySubmitError(error: unknown): SubmitFailure {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  if (message === "survey_not_active" || message === "survey_not_found") return "ended";
  if (message === "already_answered") return "already";
  if (message === "invalid_answers" || message === "required_missing" || message === "not_allowed" || message === "account_inactive") return "invalid";
  return "network";
}

/** "Frage 2 von 5". */
export function progressText(index: number, total: number): string {
  return `Frage ${index + 1} von ${total}`;
}

/** One's own answer as text ("Nicht beantwortet" when skipped). */
export function formatOwnAnswer(question: SurveyQuestion, value: unknown): string {
  if (!hasAnswer(question, value)) return "Nicht beantwortet";
  switch (question.kind) {
    case "single":
      return typeof value === "number" ? (question.options?.[value] ?? "–") : "–";
    case "multiple":
      return Array.isArray(value) ? value.map((i) => (typeof i === "number" ? (question.options?.[i] ?? "–") : "–")).join(", ") : "–";
    case "scale":
      return typeof value === "number" ? `${value} (Skala ${question.scaleMin ?? "–"} bis ${question.scaleMax ?? "–"})` : "–";
    case "yes_no":
      return value === true ? "Ja" : value === false ? "Nein" : "–";
    case "text":
      return typeof value === "string" ? value : "–";
  }
}
