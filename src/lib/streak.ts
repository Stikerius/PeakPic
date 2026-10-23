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

/**
 * A completed plan entry since the active plan's order last changed (see plan_proofs() in the
 * database): a training proof (with its plan day if assigned) or a confirmed planned rest day.
 */
export type PlanProof = {
  day: DayKey;
  /** ISO timestamp; orders proofs of the same day. */
  createdAt: string;
  planDayId: string | null;
  /** Default "training". */
  kind?: "training" | "rest";
};

/** A day of the plan cycle: a training day or a planned rest day. */
export type PlanEntry = { id: string; type: "training" | "rest" };

/** Ids of the planned rest days of a plan. */
export function restEntryIds(entries: readonly PlanEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.type === "rest").map((e) => e.id));
}

/** First training day at or after `index` in the cycle (the unit to pick for a post). */
export function nextTrainingIndex(entries: readonly PlanEntry[], index: number): number {
  if (entries.length === 0) return 0;
  for (let step = 0; step < entries.length; step += 1) {
    const i = (index + step) % entries.length;
    if (entries[i]?.type === "training") return i;
  }
  return index % entries.length;
}

function sortProofs(proofs: readonly PlanProof[]): PlanProof[] {
  return [...proofs].sort((a, b) =>
    a.day === b.day ? a.createdAt.localeCompare(b.createdAt) : a.day.localeCompare(b.day),
  );
}

/**
 * Progress through the current round: one pass through the plan's days in their CURRENT order.
 * Progress is kept by day id, so reordering, adding or removing days never resets it: what was
 * done in this round stays done, and the next unit is the first one not done yet. Same rule as
 * plan_round_next() in the database.
 */
export type PlanRound = {
  /** Days done in the current round. */
  done: Set<string>;
  /** The unit due next (training or rest day). */
  nextIndex: number;
  /** The next training day of the round (to pick for a post or a training). */
  nextTrainingIndex: number;
  /** Day of the last completed plan entry, null if none. */
  lastDay: DayKey | null;
};

/**
 * Applies one proof to the round. A training proof is "on plan" when its unit is the first one
 * not done yet, or when only planned rest days come before it (training instead of resting skips
 * them, they count as done). Any other unit of the plan is still done (it doesn't come again in
 * this round), but not on plan. Returns null for proofs without a unit of this plan.
 */
function applyProof(entries: readonly PlanEntry[], done: Set<string>, proof: PlanProof): { onPlan: boolean } | null {
  const index = proof.planDayId !== null ? entries.findIndex((e) => e.id === proof.planDayId) : -1;
  if (index === -1) return null;
  let onPlan = true;
  if (proof.kind !== "rest") {
    const before = entries.slice(0, index).filter((e) => !done.has(e.id));
    // A unit done again in the same round (e.g. twice Push) is a repeat, not the plan.
    onPlan = !done.has(entries[index]?.id ?? "") && before.every((e) => e.type === "rest");
    if (onPlan) before.forEach((e) => done.add(e.id));
  }
  done.add(entries[index]?.id ?? "");
  // The last open unit done: a new round starts in the plan's order.
  if (entries.every((e) => done.has(e.id))) done.clear();
  return { onPlan };
}

export function planRound(entries: readonly PlanEntry[], proofs: readonly PlanProof[]): PlanRound {
  const done = new Set<string>();
  let lastDay: DayKey | null = null;
  for (const proof of sortProofs(proofs)) {
    if (applyProof(entries, done, proof) !== null) lastDay = proof.day;
  }
  const open = (e: PlanEntry) => !done.has(e.id);
  const nextIndex = Math.max(0, entries.findIndex(open));
  let nextTraining = entries.findIndex((e) => open(e) && e.type === "training");
  if (nextTraining === -1) nextTraining = Math.max(0, entries.findIndex((e) => e.type === "training"));
  return { done, nextIndex, nextTrainingIndex: nextTraining, lastDay };
}

function entriesOf(planDayIds: readonly string[], restIds: ReadonlySet<string>): PlanEntry[] {
  return planDayIds.map((id) => ({ id, type: restIds.has(id) ? "rest" : "training" }));
}

/** Index of the unit that is due next (see planRound); the first unit if nothing is done yet. */
export function nextPlanDayIndex(
  planDayIds: readonly string[],
  proofs: readonly PlanProof[],
  restIds: ReadonlySet<string> = new Set(),
): number {
  if (planDayIds.length === 0) return 0;
  return planRound(entriesOf(planDayIds, restIds), proofs).nextIndex;
}

/**
 * Days on which every training proof was on plan (see applyProof). A proof without a unit (or
 * with one that isn't in the plan) isn't on plan and doesn't move the round on.
 */
export function correctPlanDays(
  planDayIds: readonly string[],
  proofs: readonly PlanProof[],
  restIds: ReadonlySet<string> = new Set(),
): Set<DayKey> {
  const verdict = new Map<DayKey, boolean>();
  if (planDayIds.length === 0) return new Set();
  const entries = entriesOf(planDayIds, restIds);
  const done = new Set<string>();
  for (const proof of sortProofs(proofs)) {
    const result = applyProof(entries, done, proof);
    if (proof.kind !== "rest") verdict.set(proof.day, (verdict.get(proof.day) ?? true) && (result?.onPlan ?? false));
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
  /** Planned rest days of the plan (may be skipped by training on). */
  restIds?: ReadonlySet<string>;
};

/**
 * Plan streak: consecutive training days within the normal streak run (rest days bridge)
 * on which every proof matched the unit due next. A training day with a wrong or missing
 * assignment (also a day that only counts through someone else's linked post, or one before
 * the last plan change) ends it. It never exceeds the normal streak.
 */
export function currentPlanStreak({ planDayIds, proofs, trainingDays, restDays, today, restIds }: PlanStreakInput): number {
  const correct = correctPlanDays(planDayIds, proofs, restIds);
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

// ----------------------------------------------------------------------------- planned rest days

export type PlannedRestInput = {
  /** The active plan's days in cycle order. */
  entries: readonly PlanEntry[];
  /** Completed entries since the plan's order last changed (plan_proofs()). */
  proofs: readonly PlanProof[];
  today: DayKey;
  /** All training days (a rest day can't be on one). */
  trainingDays: ReadonlySet<DayKey>;
  /** Rest days already used (budget and planned). */
  restDays: ReadonlySet<DayKey>;
};

/**
 * The planned rest day that can be confirmed now, mirroring use_planned_rest_day: the unit due
 * next in the round is a rest day, the last completed plan entry was on the day before, and that
 * day is today or yesterday, without training and not already a rest day. null otherwise (also
 * when nothing of the plan was done yet: a rest day needs a training day before it).
 */
export function plannedRestDue({ entries, proofs, today, trainingDays, restDays }: PlannedRestInput): {
  day: DayKey;
  entryId: string;
  index: number;
} | null {
  if (entries.length === 0) return null;
  const round = planRound(entries, proofs);
  if (round.lastDay === null) return null;
  const index = round.nextIndex;
  const entry = entries[index];
  if (entry === undefined || entry.type !== "rest") return null;
  const day = addDays(round.lastDay, 1);
  if (day !== today && day !== addDays(today, -1)) return null;
  if (trainingDays.has(day) || restDays.has(day)) return null;
  return { day, entryId: entry.id, index };
}

export function canUsePlannedRestDay(day: DayKey, input: PlannedRestInput): boolean {
  return plannedRestDue(input)?.day === day;
}

/** Rest days from all sources (budget and planned); each day once. */
export function combineRestDays(budget: readonly DayKey[], planned: readonly DayKey[]): DayKey[] {
  return [...new Set([...budget, ...planned])].sort();
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
  if (trainingDays.has(day) || uses.includes(day)) return false;
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
