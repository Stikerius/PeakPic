import { describe, expect, it } from "@jest/globals";

import {
  bucketize,
  bucketKeys,
  bucketLabel,
  epley,
  exerciseMetrics,
  exerciseSeries,
  formatTotalTime,
  mergeExercises,
  personalRecords,
  planDayShares,
  statsRange,
  statsRangeAt,
  totals,
  weekStart,
  type ExercisePoint,
  type StatsDay,
} from "@/lib/trainingStats";

function point(day: string, values: Partial<ExercisePoint> = {}): ExercisePoint {
  return {
    day,
    bestWeightKg: null,
    bestWeightReps: null,
    bestE1rmKg: null,
    volumeKg: null,
    totalReps: null,
    maxReps: null,
    totalSeconds: null,
    maxSeconds: null,
    ...values,
  };
}

function day(key: string, values: Partial<StatsDay> = {}): StatsDay {
  return { day: key, workouts: 1, activeSeconds: 1800, sets: 9, volumeKg: null, ...values };
}

describe("weeks and months in Europe/Zurich", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-22")).toBe("2026-10-19"); // Thursday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
  });

  it("takes the day in Zurich, not in UTC", () => {
    // Sunday 23:30 UTC is already Monday 00:30 in Zurich (winter time, UTC+1).
    expect(statsRangeAt("weeks", new Date("2026-11-01T23:30:00Z")).to).toBe("2026-11-02");
    // 31 Dec 23:30 UTC is New Year in Zurich: "this year" is the new one.
    expect(statsRangeAt("year", new Date("2026-12-31T23:30:00Z"))).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
      bucket: "month",
    });
    // Summer time (UTC+2): 22:30 UTC on the last day of the month is the 1st in Zurich.
    expect(statsRangeAt("months", new Date("2026-06-30T22:30:00Z")).to).toBe("2026-07-01");
  });

  it("covers 12 weeks and 12 months", () => {
    expect(statsRange("weeks", "2026-10-22")).toEqual({ from: "2026-08-03", to: "2026-10-22", bucket: "week" });
    expect(bucketKeys("2026-08-03", "2026-10-22", "week")).toHaveLength(12);
    expect(statsRange("months", "2026-10-22").from).toBe("2025-11-01");
    expect(bucketKeys("2025-11-01", "2026-10-22", "month")).toHaveLength(12);
  });

  it("handles the change of year", () => {
    // The week of 1 Jan 2027 (a Friday) starts in December.
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(statsRange("months", "2027-01-15").from).toBe("2026-02-01");
    expect(bucketKeys("2026-11-01", "2027-02-03", "month")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(statsRange("year", "2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-01-01", bucket: "month" });
  });

  it("labels weeks by their Monday and months by name", () => {
    expect(bucketLabel("2026-12-28", "week")).toBe("28.12.");
    expect(bucketLabel("2027-01-01", "month")).toBe("Jan");
    expect(bucketLabel("2026-03-01", "month")).toBe("Mär");
  });
});

describe("bucketize and totals", () => {
  it("groups days into weeks across the year end and fills empty weeks", () => {
    const rows = bucketize(
      [day("2026-12-29"), day("2027-01-02", { workouts: 2, activeSeconds: 3000 }), day("2027-01-05")],
      "2026-12-21",
      "2027-01-10",
      "week",
    );
    expect(rows.map((r) => [r.key, r.workouts, r.activeSeconds])).toEqual([
      ["2026-12-21", 0, 0],
      ["2026-12-28", 3, 4800],
      ["2027-01-04", 1, 1800],
    ]);
  });

  it("puts the last and the first day of a month into different months", () => {
    const rows = bucketize([day("2026-09-30"), day("2026-10-01")], "2026-09-01", "2026-10-22", "month");
    expect(rows.map((r) => r.workouts)).toEqual([1, 1]);
  });

  it("ignores days outside the period", () => {
    const rows = bucketize([day("2026-07-31"), day("2026-08-03")], "2026-08-03", "2026-08-09", "week");
    expect(rows).toEqual([{ key: "2026-08-03", workouts: 1, activeSeconds: 1800, volumeKg: null }]);
  });

  it("keeps the volume empty without weights", () => {
    expect(totals([day("2026-10-01"), day("2026-10-02")]).volumeKg).toBeNull();
    expect(totals([day("2026-10-01"), day("2026-10-02", { volumeKg: 1250.5 })])).toEqual({
      workouts: 2,
      activeSeconds: 3600,
      sets: 18,
      volumeKg: 1250.5,
    });
    const rows = bucketize([day("2026-10-01"), day("2026-10-08", { volumeKg: 100 })], "2026-09-28", "2026-10-11", "week");
    expect(rows.map((r) => r.volumeKg)).toEqual([null, 100]);
  });
});

describe("exercises", () => {
  it("estimates the max with Epley", () => {
    expect(epley(100, 1)).toBe(100);
    expect(epley(80, 5)).toBe(93.3);
    expect(epley(60, 10)).toBe(80);
    expect(epley(80, 0)).toBeNull();
  });

  it("treats different spellings as one exercise", () => {
    const merged = mergeExercises([
      { key: "bankdrücken", name: "Bankdrücken", sessions: 2, points: [point("2026-10-01", { bestWeightKg: 80, bestWeightReps: 5, volumeKg: 400 }), point("2026-10-05", { bestWeightKg: 82.5, bestWeightReps: 3 })] },
      { key: "x", name: " BANKDRÜCKEN ", sessions: 1, points: [point("2026-10-01", { bestWeightKg: 85, bestWeightReps: 2, volumeKg: 170 })] },
      { key: "y", name: "bank  drücken", sessions: 1, points: [point("2026-10-03")] },
      { key: "z", name: "Bank Drücken", sessions: 1, points: [point("2026-10-04")] },
    ]);
    expect(merged.map((e) => [e.key, e.sessions])).toEqual([
      ["bank drücken", 2],
      ["bankdrücken", 2],
    ]);
    const first = merged.find((e) => e.key === "bankdrücken")?.points[0];
    expect(first).toMatchObject({ bestWeightKg: 85, bestWeightReps: 2, volumeKg: 570 });
  });

  it("shows reps and time where weights are missing", () => {
    expect(exerciseMetrics([point("2026-10-01", { maxReps: 12 })])).toEqual(["reps"]);
    expect(exerciseMetrics([point("2026-10-01", { maxSeconds: 60 }), point("2026-10-02", { maxReps: 20 })])).toEqual(["reps", "seconds"]);
    expect(exerciseMetrics([point("2026-10-01", { bestWeightKg: 20, maxReps: 10 })])).toEqual(["e1rm", "weight", "volume"]);
    expect(exerciseMetrics([point("2026-10-01")])).toEqual([]);
  });

  it("builds a series without empty sessions", () => {
    const points = [point("2026-10-01", { maxReps: 10 }), point("2026-10-03"), point("2026-10-05", { maxReps: 12 })];
    expect(exerciseSeries(points, "reps")).toEqual([
      { day: "2026-10-01", value: 10 },
      { day: "2026-10-05", value: 12 },
    ]);
    expect(exerciseSeries(points, "e1rm")).toEqual([]);
  });

  it("finds personal records, the first day on a tie", () => {
    const records = personalRecords([
      point("2026-10-08", { bestWeightKg: 90, bestWeightReps: 3, bestE1rmKg: 99, volumeKg: 500 }),
      point("2026-10-01", { bestWeightKg: 90, bestWeightReps: 2, bestE1rmKg: 96, volumeKg: 800 }),
      point("2026-10-04", { maxReps: 15, maxSeconds: 45 }),
    ]);
    expect(records.heaviest).toEqual({ weightKg: 90, reps: 2, day: "2026-10-01" });
    expect(records.bestE1rm).toEqual({ valueKg: 99, day: "2026-10-08" });
    expect(records.bestVolume).toEqual({ valueKg: 800, day: "2026-10-01" });
    expect(records.mostReps).toEqual({ reps: 15, day: "2026-10-04" });
    expect(records.longest).toEqual({ seconds: 45, day: "2026-10-04" });
    expect(personalRecords([]).heaviest).toBeNull();
  });
});

describe("plan days", () => {
  it("adds free trainings and computes shares", () => {
    expect(planDayShares([{ title: "Push", workouts: 3 }, { title: "Pull", workouts: 1 }], 4)).toEqual([
      { title: "Freies Training", workouts: 4, share: 0.5 },
      { title: "Push", workouts: 3, share: 0.375 },
      { title: "Pull", workouts: 1, share: 0.125 },
    ]);
    expect(planDayShares([], 0)).toEqual([]);
  });
});

describe("formatTotalTime", () => {
  it("shows minutes and hours", () => {
    expect(formatTotalTime(0)).toBe("0 min");
    expect(formatTotalTime(2700)).toBe("45 min");
    expect(formatTotalTime(11100)).toBe("3 h 05 min");
  });
});
