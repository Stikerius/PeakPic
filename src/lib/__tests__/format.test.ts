import { describe, expect, it } from "@jest/globals";

import { formatDayTitle, formatRelativeTime, formatTime } from "@/lib/format";

const now = new Date("2026-05-10T12:00:00Z");

describe("formatRelativeTime", () => {
  it("formats recent times relatively", () => {
    expect(formatRelativeTime("2026-05-10T11:59:30Z", now)).toBe("gerade eben");
    expect(formatRelativeTime("2026-05-10T11:55:00Z", now)).toBe("vor 5 Min.");
    expect(formatRelativeTime("2026-05-10T09:00:00Z", now)).toBe("vor 3 Std.");
    expect(formatRelativeTime("2026-05-08T12:00:00Z", now)).toBe("vor 2 T.");
  });

  it("treats future timestamps (clock skew) as just now", () => {
    expect(formatRelativeTime("2026-05-10T12:01:00Z", now)).toBe("gerade eben");
  });

  it("shows a Zurich date after a week", () => {
    expect(formatRelativeTime("2026-04-01T22:30:00Z", now)).toBe("02.04.2026");
  });
});

describe("formatDayTitle", () => {
  it("formats day keys with German weekday and month", () => {
    expect(formatDayTitle("2026-10-19")).toBe("Montag, 19. Oktober 2026");
    expect(formatDayTitle("2027-01-01")).toBe("Freitag, 1. Januar 2027");
  });
});

describe("formatTime", () => {
  it("uses Zurich time", () => {
    expect(formatTime("2026-07-14T16:42:00Z")).toBe("18:42");
    expect(formatTime("2026-01-14T16:42:00Z")).toBe("17:42");
  });
});
