import { describe, expect, it } from "@jest/globals";

import { combineTrainingDays, computeStreakStatsFromDays } from "@/lib/streak";
import { isWorkoutLinkExpired } from "@/lib/workoutLinks";

describe("isWorkoutLinkExpired", () => {
  it("can be answered on the workout day and the day after", () => {
    expect(isWorkoutLinkExpired("2026-10-19", "2026-10-19")).toBe(false);
    expect(isWorkoutLinkExpired("2026-10-19", "2026-10-20")).toBe(false);
  });

  it("expires two days later, also across months", () => {
    expect(isWorkoutLinkExpired("2026-10-19", "2026-10-21")).toBe(true);
    expect(isWorkoutLinkExpired("2026-10-31", "2026-11-01")).toBe(false);
    expect(isWorkoutLinkExpired("2026-10-31", "2026-11-02")).toBe(true);
  });
});

describe("combineTrainingDays", () => {
  it("counts a shared day once, even if I also posted", () => {
    expect(combineTrainingDays(["2026-10-18", "2026-10-19"], ["2026-10-19"])).toEqual(["2026-10-18", "2026-10-19"]);
  });

  it("extends the streak with shared days", () => {
    const days = combineTrainingDays(["2026-10-17", "2026-10-19"], ["2026-10-18"]);
    expect(computeStreakStatsFromDays(days, "2026-10-19").current).toBe(3);
  });
});
