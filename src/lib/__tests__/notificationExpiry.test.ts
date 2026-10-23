import { describe, expect, it } from "@jest/globals";

import { isNotificationExpired, notificationExpiresAt } from "@/lib/notificationExpiry";

const DAY = 24 * 60 * 60 * 1000;
const created = "2026-10-01T10:00:00.000Z";
const at = (iso: string, plusMs: number) => new Date(new Date(iso).getTime() + plusMs);

describe("notification expiry", () => {
  it("unseen: exactly 14 days after creation", () => {
    expect(notificationExpiresAt(created, null).toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(isNotificationExpired(created, null, at(created, 14 * DAY - 1))).toBe(false);
    expect(isNotificationExpired(created, null, at(created, 14 * DAY))).toBe(true);
  });

  it("seen: exactly 7 days after it was seen", () => {
    const seen = "2026-10-03T08:00:00.000Z";
    expect(notificationExpiresAt(created, seen).toISOString()).toBe("2026-10-10T08:00:00.000Z");
    expect(isNotificationExpired(created, seen, at(seen, 7 * DAY - 1))).toBe(false);
    expect(isNotificationExpired(created, seen, at(seen, 7 * DAY))).toBe(true);
  });

  it("seen after 10 days is capped at 14 days after creation", () => {
    const seen = at(created, 10 * DAY);
    expect(notificationExpiresAt(created, seen).toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(isNotificationExpired(created, seen, at(created, 13 * DAY))).toBe(false);
    expect(isNotificationExpired(created, seen, at(created, 14 * DAY))).toBe(true);
  });

  it("counts exact hours across the change to summer time", () => {
    // Created on 20 March 2026, 13:00 in Zurich (12:00 UTC); summer time starts on 29 March.
    const before = "2026-03-20T12:00:00.000Z";
    const expires = notificationExpiresAt(before, null);
    expect(expires.getTime() - new Date(before).getTime()).toBe(14 * DAY);
    // Same instant in UTC, one hour later on the Zurich wall clock (14:00 instead of 13:00).
    expect(expires.toISOString()).toBe("2026-04-03T12:00:00.000Z");
  });

  it("counts exact hours across the change to winter time", () => {
    const seen = "2026-10-22T09:00:00.000Z";
    expect(notificationExpiresAt("2026-10-20T09:00:00.000Z", seen).toISOString()).toBe("2026-10-29T09:00:00.000Z");
  });
});
