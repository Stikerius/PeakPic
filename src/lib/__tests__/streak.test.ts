import {
  addDays,
  addMonths,
  computeStreakStats,
  currentStreak,
  flameTier,
  longestStreak,
  monthGrid,
  runLengthByDay,
  toDayKey,
  toTrainingDays,
} from "@/lib/streak";

const days = (...keys: string[]) => new Set(keys);

describe("toDayKey", () => {
  it("uses Zurich local time, not UTC (winter, UTC+1)", () => {
    // 23:30 UTC on Jan 14 is 00:30 on Jan 15 in Zurich.
    expect(toDayKey(new Date("2026-01-14T23:30:00Z"))).toBe("2026-01-15");
    expect(toDayKey(new Date("2026-01-14T22:59:00Z"))).toBe("2026-01-14");
  });

  it("uses Zurich local time in summer (UTC+2)", () => {
    expect(toDayKey(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
    expect(toDayKey(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
  });

  it("puts New Year's Eve late-night workouts in the new year", () => {
    expect(toDayKey(new Date("2026-12-31T23:15:00Z"))).toBe("2027-01-01");
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("is not affected by DST transitions", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });
});

describe("toTrainingDays", () => {
  it("counts several photos on the same day once", () => {
    const result = toTrainingDays([
      "2026-05-10T06:00:00Z",
      "2026-05-10T12:00:00Z",
      "2026-05-10T20:00:00Z",
    ]);
    expect([...result]).toEqual(["2026-05-10"]);
  });
});

describe("currentStreak", () => {
  it("is 0 without any training", () => {
    expect(currentStreak(days(), "2026-05-10")).toBe(0);
  });

  it("counts consecutive days up to today", () => {
    expect(currentStreak(days("2026-05-08", "2026-05-09", "2026-05-10"), "2026-05-10")).toBe(3);
  });

  it("keeps the streak when today is still missing", () => {
    expect(currentStreak(days("2026-05-08", "2026-05-09"), "2026-05-10")).toBe(2);
  });

  it("breaks when yesterday is missing too", () => {
    expect(currentStreak(days("2026-05-07", "2026-05-08"), "2026-05-10")).toBe(0);
  });

  it("stops at a gap", () => {
    expect(
      currentStreak(days("2026-05-05", "2026-05-06", "2026-05-08", "2026-05-09"), "2026-05-09"),
    ).toBe(2);
  });

  it("continues across a month boundary", () => {
    expect(currentStreak(days("2026-04-29", "2026-04-30", "2026-05-01"), "2026-05-01")).toBe(3);
  });

  it("continues across a year boundary", () => {
    expect(currentStreak(days("2026-12-30", "2026-12-31", "2027-01-01"), "2027-01-02")).toBe(3);
  });
});

describe("longestStreak and runLengthByDay", () => {
  it("finds the longest run, even if it is in the past", () => {
    const d = days(
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
      "2026-01-10", "2026-01-11",
    );
    expect(longestStreak(d)).toBe(4);
    expect(runLengthByDay(d).get("2026-01-04")).toBe(4);
    expect(runLengthByDay(d).get("2026-01-10")).toBe(1);
  });

  it("handles runs across the year boundary", () => {
    expect(longestStreak(days("2026-12-31", "2027-01-01", "2027-01-02"))).toBe(3);
  });

  it("is 0 for no training days", () => {
    expect(longestStreak(days())).toBe(0);
  });
});

describe("computeStreakStats", () => {
  it("combines timestamps into current and longest streak in Zurich time", () => {
    const stats = computeStreakStats(
      ["2026-05-08T08:00:00Z", "2026-05-08T19:00:00Z", "2026-05-09T22:30:00Z"],
      new Date("2026-05-11T09:00:00Z"),
    );
    // 2026-05-09T22:30Z is 00:30 on May 10 in Zurich → days 8 and 10, gap on 9.
    expect([...stats.trainingDays].sort()).toEqual(["2026-05-08", "2026-05-10"]);
    expect(stats.current).toBe(1);
    expect(stats.longest).toBe(1);
  });
});

describe("flameTier", () => {
  it("steps up at 3, 7 and 30 days", () => {
    expect([0, 2, 3, 6, 7, 29, 30, 100].map(flameTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("calendar helpers", () => {
  it("wraps months across years", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("lays out a month starting on Monday", () => {
    // June 2026 starts on a Monday and has 30 days.
    const june = monthGrid(2026, 6);
    expect(june[0]?.[0]).toBe("2026-06-01");
    expect(june).toHaveLength(5);
    // February 2026 starts on a Sunday.
    const feb = monthGrid(2026, 2);
    expect(feb[0]).toEqual([null, null, null, null, null, null, "2026-02-01"]);
    expect(feb.every((week) => week.length === 7)).toBe(true);
  });
});
