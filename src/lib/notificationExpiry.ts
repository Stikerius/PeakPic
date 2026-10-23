/**
 * When a stored notification expires (same rule as notification_expires_at() in the database):
 * unseen 14 days after it was created; seen 7 days after it was seen, but never later than 14
 * days after creation. Counted in exact hours, so daylight saving time doesn't move it.
 */

const HOUR_MS = 60 * 60 * 1000;
export const UNSEEN_LIFETIME_HOURS = 14 * 24;
export const SEEN_LIFETIME_HOURS = 7 * 24;

export function notificationExpiresAt(createdAt: string | Date, readAt: string | Date | null): Date {
  const created = new Date(createdAt).getTime();
  const byCreation = created + UNSEEN_LIFETIME_HOURS * HOUR_MS;
  if (readAt === null) return new Date(byCreation);
  return new Date(Math.min(byCreation, new Date(readAt).getTime() + SEEN_LIFETIME_HOURS * HOUR_MS));
}

/** Expired at `now` (the moment of expiry counts as expired, like `<= now()` in the database). */
export function isNotificationExpired(createdAt: string | Date, readAt: string | Date | null, now: Date = new Date()): boolean {
  return notificationExpiresAt(createdAt, readAt).getTime() <= now.getTime();
}
