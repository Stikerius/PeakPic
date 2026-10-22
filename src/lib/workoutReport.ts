/**
 * Pure helpers for the training report ("Trainingsbericht") of a saved training. No I/O, unit
 * tested. Exercise names are grouped case- and space-insensitively.
 */

export type ReportSet = {
  reps: number | null;
  weightKg: number | null;
  seconds: number | null;
  /** ISO timestamp, if recorded. */
  completedAt: string | null;
};

export type ReportExercise = { name: string; sets: ReportSet[] };

export type Trend = "up" | "down" | "same";

/** "  Bankdrücken " and "bankdrücken" are the same exercise. */
export function normalizeExerciseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-CH");
}

export function setCount(exercises: readonly ReportExercise[]): number {
  return exercises.reduce((sum, e) => sum + e.sets.length, 0);
}

/** Weight × reps over all sets with both; null without any weight. */
export function reportVolume(exercises: readonly ReportExercise[]): number | null {
  let total = 0;
  let any = false;
  for (const e of exercises) {
    for (const s of e.sets) {
      if (s.weightKg !== null && s.reps !== null) {
        total += s.weightKg * s.reps;
        any = true;
      }
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

/** From the first to the last recorded set, in seconds (0 with fewer than two). */
export function exerciseDurationSeconds(sets: readonly ReportSet[]): number {
  const times = sets.flatMap((s) => (s.completedAt !== null ? [Date.parse(s.completedAt)] : [])).filter((t) => !Number.isNaN(t));
  if (times.length < 2) return 0;
  return Math.round((Math.max(...times) - Math.min(...times)) / 1000);
}

/** The best set: highest weight (then reps); without weights most reps; for time sets the longest. */
export function topSet(sets: readonly ReportSet[]): ReportSet | null {
  let best: ReportSet | null = null;
  const score = (s: ReportSet): [number, number, number] => [s.weightKg ?? -1, s.reps ?? -1, s.seconds ?? -1];
  for (const s of sets) {
    if (best === null) {
      best = s;
      continue;
    }
    const [aw, ar, as] = score(s);
    const [bw, br, bs] = score(best);
    if (aw > bw || (aw === bw && (ar > br || (ar === br && as > bs)))) best = s;
  }
  return best;
}

function trend(current: number | null, previous: number | null): Trend | null {
  if (current === null || previous === null) return null;
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "same";
}

/** Top set compared to the top set of the last session of the same exercise. */
export function compareToPrevious(
  current: readonly ReportSet[],
  previous: readonly ReportSet[] | null,
): { weight: Trend | null; reps: Trend | null; seconds: Trend | null } | null {
  if (previous === null || previous.length === 0) return null;
  const a = topSet(current);
  const b = topSet(previous);
  if (a === null || b === null) return null;
  return { weight: trend(a.weightKg, b.weightKg), reps: trend(a.reps, b.reps), seconds: trend(a.seconds, b.seconds) };
}

/** Sets of the same exercise in the most recent earlier training (input newest first). */
export function findPreviousSets(name: string, earlier: readonly { exercises: readonly ReportExercise[] }[]): ReportSet[] | null {
  const key = normalizeExerciseName(name);
  for (const workout of earlier) {
    const match = workout.exercises.filter((e) => normalizeExerciseName(e.name) === key);
    if (match.length > 0) return match.flatMap((e) => e.sets);
  }
  return null;
}

/** Short German text for a trend, e.g. "Gewicht ↑" (null: nothing to say). */
export function trendText(comparison: ReturnType<typeof compareToPrevious>): string | null {
  if (comparison === null) return null;
  const arrow = (t: Trend | null) => (t === "up" ? "↑" : t === "down" ? "↓" : t === "same" ? "=" : null);
  const parts: string[] = [];
  const w = arrow(comparison.weight);
  const r = arrow(comparison.reps);
  const s = arrow(comparison.seconds);
  if (w !== null) parts.push(`Gewicht ${w}`);
  if (r !== null) parts.push(`Wdh. ${r}`);
  if (s !== null && w === null && r === null) parts.push(`Zeit ${s}`);
  return parts.length > 0 ? `Zur letzten Einheit: ${parts.join(", ")}` : null;
}
