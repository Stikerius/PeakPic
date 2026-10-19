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

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "Montag, 12. Oktober 2026" for a "YYYY-MM-DD" day key. */
export function formatDayTitle(dayKey: string): string {
  const [year = 0, month = 1, day = 1] = dayKey.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${weekday}, ${day}. ${MONTHS[month - 1] ?? ""} ${year}`;
}

/** "18:42" in the app time zone. */
export function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-CH", {
      timeZone: APP_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
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
