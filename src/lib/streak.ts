/**
 * Pure streak and calendar logic. No React, no I/O — everything here is unit tested.
 *
 * Days are represented as "YYYY-MM-DD" keys in the app's time zone. Day arithmetic
 * is done on those keys in UTC, so DST transitions never shift a day.
 */

export const APP_TIME_ZONE = "Europe/Zurich";

/** Calendar day in the app time zone, formatted "YYYY-MM-DD". */
export type DayKey = string;

export type FlameTier = 0 | 1 | 2 | 3;

/** Streak lengths at which the flame grows to the next tier. */
export const FLAME_TIER_THRESHOLDS = [3, 7, 30] as const;

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function getDayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayKeyFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDayKey(year: number, month: number, day: number): DayKey {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Converts an instant to the calendar day it falls on in `timeZone`. */
export function toDayKey(date: Date, timeZone: string = APP_TIME_ZONE): DayKey {
  try {
    const parts = getDayKeyFormatter(timeZone).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value);
    return formatDayKey(get("year"), get("month"), get("day"));
  } catch {
    // Engines without time zone support: fall back to the device's local day.
    return formatDayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
}

export function parseDayKey(key: DayKey): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

export function addDays(key: DayKey, amount: number): DayKey {
  const { year, month, day } = parseDayKey(key);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return formatDayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Unique training days from workout timestamps; several workouts on one day count once. */
export function toTrainingDays(
  timestamps: readonly (string | Date)[],
  timeZone: string = APP_TIME_ZONE,
): Set<DayKey> {
  return new Set(
    timestamps.map((t) => toDayKey(typeof t === "string" ? new Date(t) : t, timeZone)),
  );
}

const NO_DAYS: ReadonlySet<DayKey> = new Set();

/**
 * Consecutive training days ending today or yesterday.
 * Not having trained *yet* today keeps yesterday's streak alive.
 * Rest days bridge a gap (the run goes on) but don't add to the count; a rest day on a
 * training day counts once, as the training day.
 */
export function currentStreak(
  days: ReadonlySet<DayKey>,
  today: DayKey,
  restDays: ReadonlySet<DayKey> = NO_DAYS,
): number {
  const active = (day: DayKey) => days.has(day) || restDays.has(day);
  let cursor = active(today) ? today : addDays(today, -1);
  let streak = 0;
  while (active(cursor)) {
    if (days.has(cursor)) streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * For every training day, the length of the run of training days ending on it (rest days
 * bridge, but don't count). Used to colour each calendar flame by the streak at that point.
 */
export function runLengthByDay(
  days: ReadonlySet<DayKey>,
  restDays: ReadonlySet<DayKey> = NO_DAYS,
): Map<DayKey, number> {
  const sorted = [...new Set([...days, ...restDays])].sort();
  const runs = new Map<DayKey, number>();
  for (const day of sorted) {
    runs.set(day, (runs.get(addDays(day, -1)) ?? 0) + (days.has(day) ? 1 : 0));
  }
  return new Map([...runs].filter(([day]) => days.has(day)));
}

export function longestStreak(days: ReadonlySet<DayKey>, restDays: ReadonlySet<DayKey> = NO_DAYS): number {
  let longest = 0;
  for (const run of runLengthByDay(days, restDays).values()) {
    longest = Math.max(longest, run);
  }
  return longest;
}

export function flameTier(streak: number): FlameTier {
  const [small, medium, large] = FLAME_TIER_THRESHOLDS;
  if (streak >= large) return 3;
  if (streak >= medium) return 2;
  if (streak >= small) return 1;
  return 0;
}

export type StreakStats = {
  trainingDays: Set<DayKey>;
  current: number;
  longest: number;
};

/**
 * Training days from all sources: own training proofs plus days from accepted workout
 * links (another person's post the user was linked to). Each day counts once.
 */
export function combineTrainingDays(own: readonly DayKey[], shared: readonly DayKey[]): DayKey[] {
  return [...new Set([...own, ...shared])].sort();
}

/** Stats from training day keys (e.g. posts.workout_date); duplicates are fine. */
export function computeStreakStatsFromDays(
  days: readonly DayKey[],
  today: DayKey,
  restDays: readonly DayKey[] = [],
): StreakStats {
  const trainingDays = new Set(days);
  const rest = new Set(restDays);
  return {
    trainingDays,
    current: currentStreak(trainingDays, today, rest),
    longest: longestStreak(trainingDays, rest),
  };
}

// ----------------------------------------------------------------------------- plan streak

/** A training proof since the plan's order last changed (see plan_proofs() in the database). */
export type PlanProof = {
  day: DayKey;
  /** ISO timestamp; orders proofs of the same day. */
  createdAt: string;
  planDayId: string | null;
};

function sortProofs(proofs: readonly PlanProof[]): PlanProof[] {
  return [...proofs].sort((a, b) =>
    a.day === b.day ? a.createdAt.localeCompare(b.createdAt) : a.day.localeCompare(b.day),
  );
}

/**
 * Index of the unit that is due next: the one after the last assigned proof, wrapping
 * around at the end of the cycle; the first unit if nothing is assigned yet (also right after
 * a plan change, because only proofs since then are passed in).
 */
export function nextPlanDayIndex(planDayIds: readonly string[], proofs: readonly PlanProof[]): number {
  if (planDayIds.length === 0) return 0;
  let next = 0;
  for (const proof of sortProofs(proofs)) {
    const index = proof.planDayId !== null ? planDayIds.indexOf(proof.planDayId) : -1;
    if (index !== -1) next = (index + 1) % planDayIds.length;
  }
  return next;
}

/**
 * Days on which every proof was the unit due at that moment. A proof without a unit (or with
 * one that isn't in the plan) doesn't move the order on; a wrong unit does (the next one due
 * is the one after it), so the plan streak can restart with the next correct proof.
 */
export function correctPlanDays(planDayIds: readonly string[], proofs: readonly PlanProof[]): Set<DayKey> {
  const verdict = new Map<DayKey, boolean>();
  if (planDayIds.length === 0) return new Set();
  let expected = 0;
  for (const proof of sortProofs(proofs)) {
    const index = proof.planDayId !== null ? planDayIds.indexOf(proof.planDayId) : -1;
    verdict.set(proof.day, (verdict.get(proof.day) ?? true) && index === expected);
    if (index !== -1) expected = (index + 1) % planDayIds.length;
  }
  return new Set([...verdict].filter(([, ok]) => ok).map(([day]) => day));
}

export type PlanStreakInput = {
  /** Unit ids in cycle order. */
  planDayIds: readonly string[];
  /** Own proofs since the plan's order last changed. */
  proofs: readonly PlanProof[];
  /** All training days for the normal streak (own and linked). */
  trainingDays: ReadonlySet<DayKey>;
  restDays: ReadonlySet<DayKey>;
  today: DayKey;
};

/**
 * Plan streak: consecutive training days within the normal streak run (rest days bridge)
 * on which every proof matched the unit due next. A training day with a wrong or missing
 * assignment (also a day that only counts through someone else's linked post, or one before
 * the last plan change) ends it. It never exceeds the normal streak.
 */
export function currentPlanStreak({ planDayIds, proofs, trainingDays, restDays, today }: PlanStreakInput): number {
  const correct = correctPlanDays(planDayIds, proofs);
  const active = (day: DayKey) => trainingDays.has(day) || restDays.has(day);
  let cursor = active(today) ? today : addDays(today, -1);
  let streak = 0;
  while (active(cursor)) {
    if (trainingDays.has(cursor)) {
      if (!correct.has(cursor)) break;
      streak += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// ----------------------------------------------------------------------------- rest days

/** The number of rest days per week can change again this many days after it was set. */
export const REST_BUDGET_LOCK_DAYS = 21;
/** Highest "rest days per week" the database accepts (set_rest_budget). */
export const MAX_RESTS_PER_WEEK = 6;

export function daysBetween(from: DayKey, to: DayKey): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** The calendar week (Monday to Sunday) containing `day`: [start, end). */
export function restWeek(day: DayKey): { start: DayKey; end: DayKey } {
  const { year, month, day: d } = parseDayKey(day);
  // getUTCDay: 0 = Sunday; shift so Monday = 0 (same as monthGrid).
  const fromMonday = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;
  const start = addDays(day, -fromMonday);
  return { start, end: addDays(start, 7) };
}

/** Rest days per week, set on `cycleStart`. */
export type RestBudget = { restsPerWeek: number; cycleStart: DayKey };

export type RestStatus = {
  total: number;
  used: number;
  remaining: number;
  periodStart: DayKey;
  /** Exclusive. */
  periodEnd: DayKey;
  /** First day the number can be changed again (21 days after it was set). */
  changeableFrom: DayKey;
};

/** Same rules as the database: rest days used in the week of `today`, and what's left. */
export function restStatus(budget: RestBudget, uses: readonly DayKey[], today: DayKey): RestStatus {
  const { start, end } = restWeek(today);
  const used = new Set(uses.filter((day) => day >= start && day < end)).size;
  return {
    total: budget.restsPerWeek,
    used,
    remaining: Math.max(0, budget.restsPerWeek - used),
    periodStart: start,
    periodEnd: end,
    changeableFrom: addDays(budget.cycleStart, REST_BUDGET_LOCK_DAYS),
  };
}

/**
 * Whether a rest day may be used for `day` (mirrors use_rest_day): today or yesterday, no
 * training that day, not already a rest day, and budget left in that day's week.
 */
export function canUseRestDay(
  day: DayKey,
  today: DayKey,
  budget: RestBudget | null,
  uses: readonly DayKey[],
  trainingDays: ReadonlySet<DayKey>,
): boolean {
  if (budget === null || budget.restsPerWeek === 0) return false;
  if (day !== today && day !== addDays(today, -1)) return false;
  if (day < budget.cycleStart || trainingDays.has(day) || uses.includes(day)) return false;
  return restStatus(budget, uses, day).remaining > 0;
}

export function computeStreakStats(
  timestamps: readonly (string | Date)[],
  now: Date,
  timeZone: string = APP_TIME_ZONE,
): StreakStats {
  return computeStreakStatsFromDays(
    [...toTrainingDays(timestamps, timeZone)],
    toDayKey(now, timeZone),
  );
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shifts a (year, month) pair by `amount` months; month is 1-12. */
export function addMonths(
  year: number,
  month: number,
  amount: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + amount;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Month laid out in weeks starting on Monday. Cells outside the month are `null`.
 * Always returns full weeks of 7 cells.
 */
export function monthGrid(year: number, month: number): (DayKey | null)[][] {
  // getUTCDay: 0 = Sunday; shift so Monday = 0.
  const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (DayKey | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    cells.push(formatDayKey(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (DayKey | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
