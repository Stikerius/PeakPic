/**
 * Pure helpers for the training statistics ("Statistik"). The database aggregates per day and
 * exercise (get_training_stats); this file groups those numbers into weeks and months, picks
 * series for the charts and finds personal records. No I/O, unit tested.
 *
 * Days are "YYYY-MM-DD" keys in Europe/Zurich (see lib/streak.ts); weeks run Monday to Sunday.
 */

import { addDays, parseDayKey, formatDayKey, toDayKey, type DayKey } from "@/lib/streak";
import { normalizeExerciseName } from "@/lib/workoutReport";

export type StatsRange = "weeks" | "months" | "year";
export type StatsBucket = "week" | "month";

/** Sums of one day (all trainings of that day together). */
export type StatsDay = {
  day: DayKey;
  workouts: number;
  activeSeconds: number;
  sets: number;
  /** Weight × reps; null when no weights were recorded that day. */
  volumeKg: number | null;
};

/** One exercise on one day. Weight values are null where no weight was recorded. */
export type ExercisePoint = {
  day: DayKey;
  bestWeightKg: number | null;
  /** Reps of the heaviest set. */
  bestWeightReps: number | null;
  bestE1rmKg: number | null;
  volumeKg: number | null;
  totalReps: number | null;
  maxReps: number | null;
  totalSeconds: number | null;
  maxSeconds: number | null;
};

export type ExerciseStats = { key: string; name: string; sessions: number; points: ExercisePoint[] };

export type PlanDayCount = { title: string | null; workouts: number };

export type TrainingStats = {
  range: StatsRange;
  bucket: StatsBucket;
  from: DayKey;
  to: DayKey;
  days: StatsDay[];
  exercises: ExerciseStats[];
  planDays: PlanDayCount[];
  freeWorkouts: number;
  currentStreak: number;
  longestStreak: number;
};

/** Monday of the week that contains `day`. */
export function weekStart(day: DayKey): DayKey {
  const { year, month, day: d } = parseDayKey(day);
  const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function monthStart(day: DayKey): DayKey {
  const { year, month } = parseDayKey(day);
  return formatDayKey(year, month, 1);
}

function addMonthsToStart(start: DayKey, amount: number): DayKey {
  const { year, month } = parseDayKey(start);
  const index = year * 12 + (month - 1) + amount;
  return formatDayKey(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function bucketStart(day: DayKey, bucket: StatsBucket): DayKey {
  return bucket === "week" ? weekStart(day) : monthStart(day);
}

/**
 * The period of a range up to `today` (same as training_stats_range() in the database): the last
 * 12 calendar weeks by week, the last 12 calendar months by month, or this calendar year by month.
 */
export function statsRange(range: StatsRange, today: DayKey): { from: DayKey; to: DayKey; bucket: StatsBucket } {
  switch (range) {
    case "weeks":
      return { from: addDays(weekStart(today), -77), to: today, bucket: "week" };
    case "months":
      return { from: addMonthsToStart(monthStart(today), -11), to: today, bucket: "month" };
    case "year":
      return { from: formatDayKey(parseDayKey(today).year, 1, 1), to: today, bucket: "month" };
  }
}

/** Same, for an instant: the day is taken in Europe/Zurich. */
export function statsRangeAt(range: StatsRange, now: Date) {
  return statsRange(range, toDayKey(now));
}

/** All bucket starts from `from` to `to`, oldest first. */
export function bucketKeys(from: DayKey, to: DayKey, bucket: StatsBucket): DayKey[] {
  const keys: DayKey[] = [];
  let cursor = bucketStart(from, bucket);
  const last = bucketStart(to, bucket);
  while (cursor <= last && keys.length < 400) {
    keys.push(cursor);
    cursor = bucket === "week" ? addDays(cursor, 7) : addMonthsToStart(cursor, 1);
  }
  return keys;
}

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"] as const;

/** "19.10." for a week (its Monday), "Okt" for a month. */
export function bucketLabel(key: DayKey, bucket: StatsBucket): string {
  const { month, day } = parseDayKey(key);
  return bucket === "week" ? `${day}.${month}.` : (MONTHS[month - 1] ?? "");
}

export type StatsBucketRow = { key: DayKey; workouts: number; activeSeconds: number; volumeKg: number | null };

/** Day sums grouped into weeks or months; buckets without trainings are there with 0. */
export function bucketize(days: readonly StatsDay[], from: DayKey, to: DayKey, bucket: StatsBucket): StatsBucketRow[] {
  const rows = new Map<DayKey, StatsBucketRow>(
    bucketKeys(from, to, bucket).map((key) => [key, { key, workouts: 0, activeSeconds: 0, volumeKg: null }]),
  );
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    const row = rows.get(bucketStart(d.day, bucket));
    if (row === undefined) continue;
    row.workouts += d.workouts;
    row.activeSeconds += d.activeSeconds;
    if (d.volumeKg !== null) row.volumeKg = (row.volumeKg ?? 0) + d.volumeKg;
  }
  return [...rows.values()];
}

export function totals(days: readonly StatsDay[]): {
  workouts: number;
  activeSeconds: number;
  sets: number;
  volumeKg: number | null;
} {
  let volume: number | null = null;
  let workouts = 0;
  let activeSeconds = 0;
  let sets = 0;
  for (const d of days) {
    workouts += d.workouts;
    activeSeconds += d.activeSeconds;
    sets += d.sets;
    if (d.volumeKg !== null) volume = (volume ?? 0) + d.volumeKg;
  }
  return { workouts, activeSeconds, sets, volumeKg: volume === null ? null : Math.round(volume * 10) / 10 };
}

/** Estimated one-rep max (Epley): weight × (1 + reps / 30), the weight itself for one rep. */
export function epley(weightKg: number, reps: number): number | null {
  if (reps < 1 || weightKg < 0) return null;
  const value = reps === 1 ? weightKg : weightKg * (1 + reps / 30);
  return Math.round(value * 10) / 10;
}

function maxOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function sumOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function mergePoint(a: ExercisePoint, b: ExercisePoint): ExercisePoint {
  const heavier = (b.bestWeightKg ?? -1) > (a.bestWeightKg ?? -1) ? b : a;
  const sameWeight = a.bestWeightKg !== null && a.bestWeightKg === b.bestWeightKg;
  return {
    day: a.day,
    bestWeightKg: maxOf(a.bestWeightKg, b.bestWeightKg),
    bestWeightReps: sameWeight ? maxOf(a.bestWeightReps, b.bestWeightReps) : heavier.bestWeightReps,
    bestE1rmKg: maxOf(a.bestE1rmKg, b.bestE1rmKg),
    volumeKg: sumOf(a.volumeKg, b.volumeKg),
    totalReps: sumOf(a.totalReps, b.totalReps),
    maxReps: maxOf(a.maxReps, b.maxReps),
    totalSeconds: sumOf(a.totalSeconds, b.totalSeconds),
    maxSeconds: maxOf(a.maxSeconds, b.maxSeconds),
  };
}

/**
 * Exercises with the same normalized name ("Bankdrücken", " bankdrücken") become one; their
 * points on the same day are combined. Most done first.
 */
export function mergeExercises(list: readonly ExerciseStats[]): ExerciseStats[] {
  const groups = new Map<string, { name: string; points: Map<DayKey, ExercisePoint> }>();
  for (const exercise of list) {
    const key = normalizeExerciseName(exercise.name);
    let group = groups.get(key);
    if (group === undefined) {
      group = { name: exercise.name.trim(), points: new Map() };
      groups.set(key, group);
    }
    for (const point of exercise.points) {
      const existing = group.points.get(point.day);
      group.points.set(point.day, existing === undefined ? point : mergePoint(existing, point));
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const points = [...g.points.values()].sort((a, b) => a.day.localeCompare(b.day));
      return { key, name: g.name, sessions: points.length, points };
    })
    .sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));
}

export type ExerciseMetric = "e1rm" | "weight" | "volume" | "reps" | "seconds";

export const EXERCISE_METRIC_LABELS: Record<ExerciseMetric, string> = {
  e1rm: "Max. geschätzt",
  weight: "Bester Satz",
  volume: "Volumen",
  reps: "Wiederholungen",
  seconds: "Dauer",
};

/** What can be shown for an exercise: weights if any were recorded, otherwise reps and/or time. */
export function exerciseMetrics(points: readonly ExercisePoint[]): ExerciseMetric[] {
  const has = (pick: (p: ExercisePoint) => number | null) => points.some((p) => pick(p) !== null);
  if (has((p) => p.bestWeightKg)) return ["e1rm", "weight", "volume"];
  const metrics: ExerciseMetric[] = [];
  if (has((p) => p.maxReps)) metrics.push("reps");
  if (has((p) => p.maxSeconds)) metrics.push("seconds");
  return metrics;
}

/** One value per session for the chart (sessions without a value are left out). */
export function exerciseSeries(points: readonly ExercisePoint[], metric: ExerciseMetric): { day: DayKey; value: number }[] {
  const pick: Record<ExerciseMetric, (p: ExercisePoint) => number | null> = {
    e1rm: (p) => p.bestE1rmKg,
    weight: (p) => p.bestWeightKg,
    volume: (p) => p.volumeKg,
    reps: (p) => p.maxReps,
    seconds: (p) => p.maxSeconds,
  };
  return points.flatMap((p) => {
    const value = pick[metric](p);
    return value === null ? [] : [{ day: p.day, value }];
  });
}

export type PersonalRecords = {
  heaviest: { weightKg: number; reps: number | null; day: DayKey } | null;
  bestE1rm: { valueKg: number; day: DayKey } | null;
  bestVolume: { valueKg: number; day: DayKey } | null;
  mostReps: { reps: number; day: DayKey } | null;
  longest: { seconds: number; day: DayKey } | null;
};

/** The best values of the given sessions; on a tie the earliest day (when it was first reached). */
export function personalRecords(points: readonly ExercisePoint[]): PersonalRecords {
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  function best(pick: (p: ExercisePoint) => number | null): { value: number; point: ExercisePoint } | null {
    let result: { value: number; point: ExercisePoint } | null = null;
    for (const p of sorted) {
      const value = pick(p);
      if (value !== null && (result === null || value > result.value)) result = { value, point: p };
    }
    return result;
  }
  const heaviest = best((p) => p.bestWeightKg);
  const e1rm = best((p) => p.bestE1rmKg);
  const volume = best((p) => p.volumeKg);
  const reps = best((p) => p.maxReps);
  const seconds = best((p) => p.maxSeconds);
  return {
    heaviest: heaviest && { weightKg: heaviest.value, reps: heaviest.point.bestWeightReps, day: heaviest.point.day },
    bestE1rm: e1rm && { valueKg: e1rm.value, day: e1rm.point.day },
    bestVolume: volume && { valueKg: volume.value, day: volume.point.day },
    mostReps: reps && { reps: reps.value, day: reps.point.day },
    longest: seconds && { seconds: seconds.value, day: seconds.point.day },
  };
}

/** Trainings per plan day (and free trainings) with their share, biggest first. */
export function planDayShares(planDays: readonly PlanDayCount[], freeWorkouts: number): { title: string; workouts: number; share: number }[] {
  const rows = planDays.map((p) => ({ title: p.title ?? "Freies Training", workouts: p.workouts }));
  if (freeWorkouts > 0) rows.push({ title: "Freies Training", workouts: freeWorkouts });
  const total = rows.reduce((sum, r) => sum + r.workouts, 0);
  return rows
    .filter((r) => r.workouts > 0)
    .map((r) => ({ ...r, share: total > 0 ? r.workouts / total : 0 }))
    .sort((a, b) => b.workouts - a.workouts || a.title.localeCompare(b.title));
}

/** "45 min", "3 h 05 min" for a total time. */
export function formatTotalTime(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}
