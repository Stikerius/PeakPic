import { APP_TIME_ZONE } from "@/lib/streak";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "gerade eben", "vor 5 Min.", "vor 3 Std.", "vor 2 T." and a date after a week. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (diff < MINUTE) return "gerade eben";
  if (diff < HOUR) return `vor ${Math.floor(diff / MINUTE)} Min.`;
  if (diff < DAY) return `vor ${Math.floor(diff / HOUR)} Std.`;
  if (diff < 7 * DAY) return `vor ${Math.floor(diff / DAY)} T.`;
  return formatDate(iso);
}

/** "12.03.2026" in the app time zone. */
export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-CH", {
      timeZone: APP_TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }
}
