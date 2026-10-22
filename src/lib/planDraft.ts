/**
 * Pure helpers for the plan editor: parsing and checking the text fields, turning a draft into
 * the payload of save_plan(). No I/O, unit tested. The limits match the database
 * (training_plans, plan_days, plan_exercises, save_plan).
 */

export const PLAN_NAME_MAX_LENGTH = 40;
export const PLAN_DAY_TITLE_MAX_LENGTH = 30;
export const PLAN_DAY_NOTES_MAX_LENGTH = 300;
export const EXERCISE_NAME_MAX_LENGTH = 60;
export const EXERCISE_NOTES_MAX_LENGTH = 300;
export const PLAN_MAX_PLANS = 10;
export const PLAN_MAX_DAYS = 30;
export const PLAN_MAX_EXERCISES = 20;
export const MAX_SETS = 20;
export const MAX_REPS = 999;
export const MAX_TARGET_SECONDS = 3600;
export const MAX_WEIGHT_KG = 1000;

export type PlanDayType = "training" | "rest";

export type ExerciseDraft = {
  key: string;
  id: string | null;
  name: string;
  sets: string;
  /** "8" or "8-12". */
  reps: string;
  /** "mm:ss", optional. */
  time: string;
  /** kg, optional ("82,5" or "82.5"). */
  weight: string;
  notes: string;
};

export type DayDraft = {
  key: string;
  id: string | null;
  type: PlanDayType;
  title: string;
  notes: string;
  exercises: ExerciseDraft[];
};

export type ExercisePayload = {
  id: string | null;
  name: string;
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  target_seconds: number | null;
  target_weight_kg: number | null;
  notes: string | null;
};

export type DayPayload = {
  id: string | null;
  type: PlanDayType;
  title: string;
  notes: string | null;
  exercises: ExercisePayload[];
};

/** "mm:ss", "m:ss" or plain seconds ("90") to seconds; null for empty, NaN for invalid. */
export function parseTime(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const parts = text.split(":");
  if (parts.length > 2 || parts.some((p) => !/^\d+$/.test(p))) return Number.NaN;
  if (parts.length === 1) return Number(parts[0]);
  const [minutes, seconds] = parts.map(Number) as [number, number];
  if (seconds >= 60) return Number.NaN;
  return minutes * 60 + seconds;
}

/** Seconds as "m:ss". */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "8" or "8-12" (also "8–12" or "8 - 12"); null for empty, undefined for invalid. */
export function parseReps(value: string): { min: number; max: number | null } | null | undefined {
  const text = value.trim();
  if (text === "") return null;
  const match = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/.exec(text);
  if (match === null) return undefined;
  const min = Number(match[1]);
  const max = match[2] !== undefined ? Number(match[2]) : null;
  if (min < 1 || (max !== null && max < min)) return undefined;
  return { min, max: max === min ? null : max };
}

export function formatReps(min: number | null, max: number | null): string {
  if (min === null) return "";
  return max !== null && max !== min ? `${min}-${max}` : `${min}`;
}

/** "82,5" or "82.5" to a number; null for empty, NaN for invalid. */
export function parseWeight(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return Number.NaN;
  return Number(text);
}

export function formatWeight(kg: number | null): string {
  if (kg === null) return "";
  return Number.isInteger(kg) ? `${kg}` : `${kg}`.replace(".", ",");
}

/** "3 × 8-12 · 60 kg" style summary of a planned exercise. */
export function exerciseSummary(e: {
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetSeconds: number | null;
  targetWeightKg: number | null;
}): string {
  const target = e.targetSeconds !== null && e.repsMin === null ? formatTime(e.targetSeconds) : formatReps(e.repsMin, e.repsMax);
  const parts = [`${e.sets} × ${target}`];
  if (e.targetSeconds !== null && e.repsMin !== null) parts.push(formatTime(e.targetSeconds));
  if (e.targetWeightKg !== null) parts.push(`${formatWeight(e.targetWeightKg)} kg`);
  return parts.join(" · ");
}

function exerciseError(e: ExerciseDraft, label: string): string | null {
  if (e.name.trim() === "") return `${label}: Name fehlt.`;
  if (e.name.trim().length > EXERCISE_NAME_MAX_LENGTH) return `${label}: Name ist zu lang.`;
  const sets = Number(e.sets.trim());
  if (!/^\d+$/.test(e.sets.trim()) || sets < 1 || sets > MAX_SETS) return `${label}: Sätze 1 bis ${MAX_SETS}.`;
  const reps = parseReps(e.reps);
  if (reps === undefined) return `${label}: Wiederholungen als Zahl oder Bereich, z.B. 8 oder 8-12.`;
  if (reps !== null && (reps.min > MAX_REPS || (reps.max ?? 0) > MAX_REPS)) return `${label}: höchstens ${MAX_REPS} Wiederholungen.`;
  const time = parseTime(e.time);
  if (time !== null && (Number.isNaN(time) || time < 1 || time > MAX_TARGET_SECONDS)) {
    return `${label}: Zeit als mm:ss, höchstens 60:00.`;
  }
  if (reps === null && time === null) return `${label}: Wiederholungen oder Zeit angeben.`;
  const weight = parseWeight(e.weight);
  if (weight !== null && (Number.isNaN(weight) || weight > MAX_WEIGHT_KG)) return `${label}: Gewicht 0 bis ${MAX_WEIGHT_KG} kg.`;
  return null;
}

/** First problem of a draft as a short German text, or null if it can be saved. */
export function planDraftError(name: string, days: readonly DayDraft[]): string | null {
  if (name.trim().length === 0) return "Gib dem Plan einen Namen.";
  if (days.length === 0) return "Ein Plan braucht mindestens einen Tag.";
  if (days.length > PLAN_MAX_DAYS) return `Höchstens ${PLAN_MAX_DAYS} Tage.`;
  if (!days.some((d) => d.type === "training")) return "Ein Plan braucht mindestens einen Trainingstag.";
  for (const [index, day] of days.entries()) {
    const label = `Tag ${index + 1}`;
    if (day.title.trim().length === 0) return `${label} braucht einen Namen.`;
    if (day.type === "training") {
      if (day.exercises.length > PLAN_MAX_EXERCISES) return `${label}: höchstens ${PLAN_MAX_EXERCISES} Übungen.`;
      for (const [exIndex, exercise] of day.exercises.entries()) {
        const problem = exerciseError(exercise, `${label}, Übung ${exIndex + 1}`);
        if (problem !== null) return problem;
      }
    }
  }
  return null;
}

/** The payload of save_plan() (call planDraftError first). Rest days carry no exercises. */
export function toDayPayloads(days: readonly DayDraft[]): DayPayload[] {
  return days.map((day) => ({
    id: day.id,
    type: day.type,
    title: day.title.trim(),
    notes: day.notes.trim() === "" ? null : day.notes.trim(),
    exercises:
      day.type === "rest"
        ? []
        : day.exercises.map((e) => {
            const reps = parseReps(e.reps) ?? null;
            const time = parseTime(e.time);
            const weight = parseWeight(e.weight);
            return {
              id: e.id,
              name: e.name.trim(),
              sets: Number(e.sets.trim()),
              reps_min: reps?.min ?? null,
              reps_max: reps?.max ?? null,
              target_seconds: time === null || Number.isNaN(time) ? null : time,
              target_weight_kg: weight === null || Number.isNaN(weight) ? null : weight,
              notes: e.notes.trim() === "" ? null : e.notes.trim(),
            };
          }),
  }));
}

/** Suggestions for an exercise name: earlier names starting with (then containing) the input. */
export function suggestNames(input: string, known: readonly string[], limit = 5): string[] {
  const query = input.trim().toLowerCase();
  if (query === "") return [];
  const seen = new Set<string>();
  const unique = known.filter((name) => {
    const k = name.trim().toLowerCase();
    if (seen.has(k) || k === query) return false;
    seen.add(k);
    return true;
  });
  const starts = unique.filter((n) => n.toLowerCase().startsWith(query));
  const contains = unique.filter((n) => !n.toLowerCase().startsWith(query) && n.toLowerCase().includes(query));
  return [...starts, ...contains].slice(0, limit);
}

/** Moves an item one place up or down (unchanged at the edges). */
export function moveItem<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}
