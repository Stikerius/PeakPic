import type { StatsBucket } from "./api";

export type PeriodKey = "7d" | "30d" | "90d" | "12m" | "all";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
  { key: "12m", label: "12 Monate" },
  { key: "all", label: "Alles" },
];

export const BUCKETS: { key: StatsBucket; label: string }[] = [
  { key: "day", label: "Tag" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
  { key: "year", label: "Jahr" },
];

/** Today as YYYY-MM-DD in Europe/Zurich (the day of the counters). */
export function zurichToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** YYYY-MM-DD plus n days (calendar arithmetic in UTC, no time zone involved). */
export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Inclusive range of a period; "Alles" starts at the first counter day (or today). */
export function periodRange(key: PeriodKey, today: string, firstDay: string | null): { from: string; to: string } {
  switch (key) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "12m":
      return { from: addDays(today, -364), to: today };
    case "all": {
      const from = firstDay !== null && firstDay < today ? firstDay : today;
      // The server accepts about ten years per call.
      return { from: from < addDays(today, -3650) ? addDays(today, -3650) : from, to: today };
    }
  }
}

/** A sensible resolution for a period. */
export function defaultBucket(key: PeriodKey): StatsBucket {
  if (key === "7d" || key === "30d") return "day";
  if (key === "90d") return "week";
  return "month";
}

/** Change in percent, or null when there is nothing to compare with. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const bucketFormats: Record<StatsBucket, Intl.DateTimeFormatOptions> = {
  day: { day: "2-digit", month: "2-digit" },
  week: { day: "2-digit", month: "2-digit" },
  month: { month: "short", year: "2-digit" },
  year: { year: "numeric" },
};

/** Label of a bucket start date (YYYY-MM-DD). */
export function bucketLabel(day: string, bucket: StatsBucket): string {
  const label = new Intl.DateTimeFormat("de-CH", { ...bucketFormats[bucket], timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  return bucket === "week" ? `KW ab ${label}` : label;
}
