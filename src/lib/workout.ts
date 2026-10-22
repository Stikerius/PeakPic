/**
 * Pure logic of a recorded training ("Training aufzeichnen"). No React, no I/O, unit tested.
 *
 * Times are never counted up by a ticking timer: the draft stores timestamps (start, end, pause
 * intervals, when each set was done) and everything is computed from them, so time in the
 * background, on the lock screen or across a clock change stays right.
 */
import { parseTime, parseWeight } from "@/lib/planDraft";
import { addDays, toDayKey, type DayKey } from "@/lib/streak";

/** The plausibility rules; the same numbers as workout_rules() in the database. */
export const WORKOUT_RULES = {
  minActiveSeconds: 600,
  minSets: 3,
  maxDaysBack: 1,
  maxCountingPerDay: 2,
  maxPerDay: 20,
  maxExercises: 30,
  maxSetsPerExercise: 40,
  maxHours: 24,
} as const;

/** Drafts older than this are offered to finish or discard at app start. */
export const STALE_DRAFT_HOURS = 12;
export const MAX_REPS = 1000;
export const MAX_SET_WEIGHT_KG = 1000;

export type ActivityVisibility = "private" | "followers" | "public";

export type Pause = { start: number; end: number | null };

export type DraftSet = {
  key: string;
  reps: string;
  /** kg, optional. */
  weight: string;
  /** "mm:ss" for time exercises. */
  seconds: string;
  done: boolean;
  /** ms epoch when "Satz fertig" was tapped. */
  completedAt: number | null;
  /** Rest taken before this set, in seconds (from the rest timer). */
  restSeconds: number | null;
};

export type ExerciseTarget = {
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  seconds: number | null;
  weightKg: number | null;
};

export type DraftExercise = {
  key: string;
  name: string;
  plannedExerciseId: string | null;
  target: ExerciseTarget | null;
  /** Time exercise: sets record a duration instead of reps. */
  timed: boolean;
  sets: DraftSet[];
  /** Stopwatch for time exercises: running since startedAt, plus what ran before. */
  stopwatch: { startedAt: number | null; accumulatedMs: number };
};

export type WorkoutDraft = {
  version: 1;
  /** Sent as client_id: saving again returns the same training. */
  clientId: string;
  startedAt: number;
  /** Set when "Beenden" was tapped (the summary screen). */
  endedAt: number | null;
  pauses: Pause[];
  planId: string | null;
  planDayId: string | null;
  planDayTitle: string | null;
  exercises: DraftExercise[];
  /** Running rest timer. */
  rest: { startedAt: number; seconds: number } | null;
  /** What was typed on the summary screen (kept if the app closes before saving). */
  details?: { title: string; note: string; visibility: ActivityVisibility | null };
  updatedAt: number;
};

// ----------------------------------------------------------------------------- time

/** Paused time until `until`; an open pause runs until `until`. */
export function pausedMs(pauses: readonly Pause[], until: number): number {
  let total = 0;
  for (const pause of pauses) {
    const end = Math.min(pause.end ?? until, until);
    if (end > pause.start) total += end - pause.start;
  }
  return total;
}

export function isPaused(draft: WorkoutDraft): boolean {
  const last = draft.pauses[draft.pauses.length - 1];
  return last !== undefined && last.end === null;
}

/** Wall-clock time since the start (until the end, once finished). */
export function totalMs(draft: WorkoutDraft, now: number): number {
  return Math.max(0, (draft.endedAt ?? now) - draft.startedAt);
}

/** Time without pauses. */
export function activeMs(draft: WorkoutDraft, now: number): number {
  const until = draft.endedAt ?? now;
  return Math.max(0, until - draft.startedAt - pausedMs(draft.pauses, until));
}

export function pauseDraft(draft: WorkoutDraft, now: number): WorkoutDraft {
  if (isPaused(draft) || draft.endedAt !== null) return draft;
  return { ...draft, pauses: [...draft.pauses, { start: now, end: null }], updatedAt: now };
}

export function resumeDraft(draft: WorkoutDraft, now: number): WorkoutDraft {
  if (!isPaused(draft)) return draft;
  const pauses = draft.pauses.map((p, i) => (i === draft.pauses.length - 1 ? { ...p, end: now } : p));
  return { ...draft, pauses, updatedAt: now };
}

/** Finishing closes an open pause, so a paused training ends at the moment it was paused. */
export function finishDraft(draft: WorkoutDraft, now: number): WorkoutDraft {
  const open = draft.pauses[draft.pauses.length - 1];
  const end = open !== undefined && open.end === null ? open.start : now;
  return {
    ...draft,
    pauses: draft.pauses.map((p) => (p.end === null ? { ...p, end } : p)),
    endedAt: Math.max(end, draft.startedAt + 1000),
    rest: null,
    updatedAt: now,
  };
}

/** Back from the summary to the running training (the time after "Beenden" was a pause). */
export function reopenDraft(draft: WorkoutDraft, now: number): WorkoutDraft {
  if (draft.endedAt === null) return draft;
  return { ...draft, pauses: [...draft.pauses, { start: draft.endedAt, end: now }], endedAt: null, updatedAt: now };
}

export function isStale(draft: WorkoutDraft, now: number): boolean {
  return now - draft.startedAt > STALE_DRAFT_HOURS * 3_600_000;
}

/** "1:05:09" or "5:09". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function stopwatchMs(stopwatch: DraftExercise["stopwatch"], now: number): number {
  return stopwatch.accumulatedMs + (stopwatch.startedAt !== null ? Math.max(0, now - stopwatch.startedAt) : 0);
}

/** Seconds left on the rest timer (0 = over). */
export function restRemaining(rest: WorkoutDraft["rest"], now: number): number {
  if (rest === null) return 0;
  return Math.max(0, Math.ceil((rest.startedAt + rest.seconds * 1000 - now) / 1000));
}

// ----------------------------------------------------------------------------- sets and numbers

export type SetValues = { reps: number | null; weightKg: number | null; seconds: number | null };

/** Numbers of a set, or a short German error. */
export function parseSet(set: DraftSet, timed: boolean): SetValues | string {
  const repsText = set.reps.trim();
  let reps: number | null = null;
  if (repsText !== "") {
    if (!/^\d{1,4}$/.test(repsText) || Number(repsText) > MAX_REPS) return `Wiederholungen 0 bis ${MAX_REPS}.`;
    reps = Number(repsText);
  }
  const weight = parseWeight(set.weight);
  if (weight !== null && (Number.isNaN(weight) || weight > MAX_SET_WEIGHT_KG)) return `Gewicht 0 bis ${MAX_SET_WEIGHT_KG} kg.`;
  const seconds = parseTime(set.seconds);
  if (seconds !== null && (Number.isNaN(seconds) || seconds > 86_400)) return "Zeit als mm:ss.";
  if (timed ? seconds === null && reps === null : reps === null && seconds === null) {
    return timed ? "Zeit angeben." : "Wiederholungen angeben.";
  }
  return { reps, weightKg: weight, seconds };
}

function doneValues(exercise: DraftExercise): (SetValues & { set: DraftSet })[] {
  return exercise.sets.flatMap((set) => {
    if (!set.done) return [];
    const values = parseSet(set, exercise.timed);
    return typeof values === "string" ? [] : [{ ...values, set }];
  });
}

/** Weight × reps over all done sets with both; null when no weight was entered at all. */
export function volumeKg(exercises: readonly DraftExercise[]): number | null {
  let volume = 0;
  let any = false;
  for (const exercise of exercises) {
    for (const v of doneValues(exercise)) {
      if (v.weightKg !== null && v.reps !== null) {
        volume += v.weightKg * v.reps;
        any = true;
      }
    }
  }
  return any ? Math.round(volume * 100) / 100 : null;
}

/** From the first to the last done set of an exercise (0 with fewer than two). */
export function exerciseDurationMs(exercise: DraftExercise): number {
  const times = exercise.sets.flatMap((s) => (s.done && s.completedAt !== null ? [s.completedAt] : []));
  if (times.length < 2) return 0;
  return Math.max(...times) - Math.min(...times);
}

export type WorkoutSummary = {
  totalSeconds: number;
  activeSeconds: number;
  /** Exercises with at least one done set. */
  exercises: number;
  sets: number;
  volumeKg: number | null;
};

export function summarize(draft: WorkoutDraft, now: number): WorkoutSummary {
  const done = draft.exercises.map((e) => doneValues(e).length);
  return {
    totalSeconds: Math.floor(totalMs(draft, now) / 1000),
    activeSeconds: Math.floor(activeMs(draft, now) / 1000),
    exercises: done.filter((n) => n > 0).length,
    sets: done.reduce((a, b) => a + b, 0),
    volumeKg: volumeKg(draft.exercises),
  };
}

// ----------------------------------------------------------------------------- streak rules

export type NotCountingReason = "too_short" | "too_few_sets" | "too_old" | "daily_limit";

/**
 * Whether a training counts for the streak, mirroring save_workout() (the server decides; this
 * is for showing it before saving). Same order of reasons.
 */
export function streakVerdict(input: {
  activeSeconds: number;
  sets: number;
  workoutDay: DayKey;
  today: DayKey;
  countingThatDay: number;
}): { counts: boolean; reason: NotCountingReason | null } {
  let reason: NotCountingReason | null = null;
  if (input.activeSeconds < WORKOUT_RULES.minActiveSeconds) reason = "too_short";
  else if (input.sets < WORKOUT_RULES.minSets) reason = "too_few_sets";
  else if (input.workoutDay < addDays(input.today, -WORKOUT_RULES.maxDaysBack)) reason = "too_old";
  else if (input.countingThatDay >= WORKOUT_RULES.maxCountingPerDay) reason = "daily_limit";
  return { counts: reason === null, reason };
}

export function reasonText(reason: NotCountingReason): string {
  switch (reason) {
    case "too_short":
      return "Zählt nicht für den Streak, weil das Training kürzer als 10 Minuten war.";
    case "too_few_sets":
      return "Zählt nicht für den Streak, weil weniger als 3 Sätze erfasst sind.";
    case "too_old":
      return "Zählt nicht für den Streak, weil es länger als bis gestern zurückliegt.";
    case "daily_limit":
      return "Zählt nicht für den Streak, weil an diesem Tag schon 2 Trainings zählen.";
  }
}

/** The day a training belongs to: its start day in Europe/Zurich (like the server). */
export function workoutDay(startedAt: number): DayKey {
  return toDayKey(new Date(startedAt));
}

// ----------------------------------------------------------------------------- saving

export type WorkoutPayload = {
  client_id: string;
  plan_day_id: string | null;
  title: string | null;
  note: string | null;
  started_at: string;
  ended_at: string;
  active_seconds: number;
  visibility: ActivityVisibility;
  share_with_post: boolean;
  exercises: {
    name: string;
    planned_exercise_id: string | null;
    sets: { reps: number | null; weight_kg: number | null; seconds: number | null; rest_seconds: number | null; completed_at: string | null }[];
  }[];
};

/** The payload of save_workout(): only done, valid sets; exercises without a name or done set are left out. */
export function toWorkoutPayload(
  draft: WorkoutDraft,
  now: number,
  details: { title: string; note: string; visibility: ActivityVisibility; shareWithPost: boolean },
): WorkoutPayload {
  const ended = draft.endedAt ?? now;
  return {
    client_id: draft.clientId,
    plan_day_id: draft.planDayId,
    title: details.title.trim() === "" ? null : details.title.trim().slice(0, 60),
    note: details.note.trim() === "" ? null : details.note.trim().slice(0, 1000),
    started_at: new Date(draft.startedAt).toISOString(),
    ended_at: new Date(Math.max(ended, draft.startedAt + 1000)).toISOString(),
    active_seconds: Math.floor(activeMs(draft, now) / 1000),
    visibility: details.visibility,
    share_with_post: details.shareWithPost,
    exercises: draft.exercises
      .filter((e) => e.name.trim() !== "")
      .map((e) => ({
        name: e.name.trim().slice(0, 60),
        planned_exercise_id: e.plannedExerciseId,
        sets: doneValues(e)
          .slice(0, WORKOUT_RULES.maxSetsPerExercise)
          .map((v) => ({
            reps: v.reps,
            weight_kg: v.weightKg,
            seconds: v.seconds,
            rest_seconds: v.set.restSeconds,
            completed_at: v.set.completedAt !== null ? new Date(v.set.completedAt).toISOString() : null,
          })),
      }))
      .filter((e) => e.sets.length > 0)
      .slice(0, WORKOUT_RULES.maxExercises),
  };
}

// ----------------------------------------------------------------------------- building drafts

export type PlannedExerciseInput = {
  id: string;
  name: string;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetSeconds: number | null;
  targetWeightKg: number | null;
};

export function newSet(key: string, prefill?: { reps: string; weight: string; seconds: string }): DraftSet {
  return {
    key,
    reps: prefill?.reps ?? "",
    weight: prefill?.weight ?? "",
    seconds: prefill?.seconds ?? "",
    done: false,
    completedAt: null,
    restSeconds: null,
  };
}

export function newExercise(key: string, name: string, nextKey: () => string): DraftExercise {
  return {
    key,
    name,
    plannedExerciseId: null,
    target: null,
    timed: false,
    sets: [newSet(nextKey())],
    stopwatch: { startedAt: null, accumulatedMs: 0 },
  };
}

/** Exercises of a plan day with their target values; sets prefilled with the targets. */
export function exercisesFromPlan(planned: readonly PlannedExerciseInput[], nextKey: () => string): DraftExercise[] {
  return planned.map((p) => {
    const timed = p.repsMin === null && p.targetSeconds !== null;
    const prefill = {
      reps: p.repsMin !== null ? String(p.repsMax ?? p.repsMin) : "",
      weight: p.targetWeightKg !== null ? String(p.targetWeightKg).replace(".", ",") : "",
      seconds: "",
    };
    return {
      key: nextKey(),
      name: p.name,
      plannedExerciseId: p.id,
      target: { sets: p.sets, repsMin: p.repsMin, repsMax: p.repsMax, seconds: p.targetSeconds, weightKg: p.targetWeightKg },
      timed,
      sets: Array.from({ length: Math.min(p.sets, WORKOUT_RULES.maxSetsPerExercise) }, () => newSet(nextKey(), prefill)),
      stopwatch: { startedAt: null, accumulatedMs: 0 },
    };
  });
}

export function newDraft(input: {
  clientId: string;
  now: number;
  planId: string | null;
  planDayId: string | null;
  planDayTitle: string | null;
  exercises: DraftExercise[];
}): WorkoutDraft {
  return {
    version: 1,
    clientId: input.clientId,
    startedAt: input.now,
    endedAt: null,
    pauses: [],
    planId: input.planId,
    planDayId: input.planDayId,
    planDayTitle: input.planDayTitle,
    exercises: input.exercises,
    rest: null,
    updatedAt: input.now,
  };
}

/** Marks a set done (now); the rest taken before it comes from the running rest timer. */
export function completeSet(draft: WorkoutDraft, exerciseKey: string, setKey: string, now: number): WorkoutDraft {
  const restSeconds = draft.rest !== null ? Math.min(3600, Math.round((now - draft.rest.startedAt) / 1000)) : null;
  return {
    ...draft,
    rest: null,
    updatedAt: now,
    exercises: draft.exercises.map((e) =>
      e.key !== exerciseKey
        ? e
        : { ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, done: true, completedAt: now, restSeconds } : s)) },
    ),
  };
}

/** Accepts a stored draft only if it has the expected shape (older app versions, damaged data). */
export function isWorkoutDraft(value: unknown): value is WorkoutDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Partial<WorkoutDraft>;
  return (
    d.version === 1 &&
    typeof d.clientId === "string" &&
    typeof d.startedAt === "number" &&
    Array.isArray(d.pauses) &&
    Array.isArray(d.exercises)
  );
}
