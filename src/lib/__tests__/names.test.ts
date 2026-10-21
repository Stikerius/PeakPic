import { describe, expect, it } from "@jest/globals";

import {
  displayNameError,
  nextUsernameChange,
  usernameFormatError,
  usernameLockedMessage,
} from "@/lib/names";

const now = new Date("2026-10-21T12:00:00Z");

describe("displayNameError", () => {
  it("accepts 1 to 30 characters, also with spaces and emoji", () => {
    expect(displayNameError("I")).toBeNull();
    expect(displayNameError("Ivan Müller 💪")).toBeNull();
    expect(displayNameError("x".repeat(30))).toBeNull();
  });

  it("rejects empty and too long names", () => {
    expect(displayNameError("")).not.toBeNull();
    expect(displayNameError("x".repeat(31))).not.toBeNull();
  });
});

describe("usernameFormatError", () => {
  it("uses the same rules as sign-up", () => {
    expect(usernameFormatError("ivan_1.x")).toBeNull();
    expect(usernameFormatError("iv")).not.toBeNull();
    expect(usernameFormatError("Ivan")).not.toBeNull();
    expect(usernameFormatError("ivan-x")).not.toBeNull();
  });
});

describe("nextUsernameChange", () => {
  it("allows a change when the username was never changed", () => {
    expect(nextUsernameChange(null, now)).toBeNull();
  });

  it("locks for 14 days after a change", () => {
    const next = nextUsernameChange("2026-10-20T12:00:00Z", now);
    expect(next?.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("unlocks once 14 days have passed", () => {
    expect(nextUsernameChange("2026-10-07T12:00:00Z", now)).toBeNull();
  });
});

describe("usernameLockedMessage", () => {
  it("rounds up to whole days", () => {
    expect(usernameLockedMessage(new Date("2026-10-23T13:00:00Z"), now)).toBe(
      "Du kannst deinen Username in 3 Tagen wieder ändern.",
    );
    expect(usernameLockedMessage(new Date("2026-10-21T13:00:00Z"), now)).toBe(
      "Du kannst deinen Username in 1 Tag wieder ändern.",
    );
  });
});
