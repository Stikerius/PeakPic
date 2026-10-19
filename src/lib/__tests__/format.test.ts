import { describe, expect, it } from "@jest/globals";

import { formatRelativeTime } from "@/lib/format";

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
