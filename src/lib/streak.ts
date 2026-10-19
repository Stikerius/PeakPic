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
  const parts = getDayKeyFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return formatDayKey(get("year"), get("month"), get("day"));
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

/**
 * Consecutive training days ending today or yesterday.
 * Not having trained *yet* today keeps yesterday's streak alive.
 */
export function currentStreak(days: ReadonlySet<DayKey>, today: DayKey): number {
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * For every training day, the length of the run of consecutive days ending on it.
 * Used to colour each calendar flame by the streak it was part of at that point.
 */
export function runLengthByDay(days: ReadonlySet<DayKey>): Map<DayKey, number> {
  const sorted = [...days].sort();
  const runs = new Map<DayKey, number>();
  for (const day of sorted) {
    runs.set(day, (runs.get(addDays(day, -1)) ?? 0) + 1);
  }
  return runs;
}

export function longestStreak(days: ReadonlySet<DayKey>): number {
  let longest = 0;
  for (const run of runLengthByDay(days).values()) {
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

export function computeStreakStats(
  timestamps: readonly (string | Date)[],
  now: Date,
  timeZone: string = APP_TIME_ZONE,
): StreakStats {
  const trainingDays = toTrainingDays(timestamps, timeZone);
  return {
    trainingDays,
    current: currentStreak(trainingDays, toDayKey(now, timeZone)),
    longest: longestStreak(trainingDays),
  };
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
