import { describe, expect, it } from "@jest/globals";

import {
  compareToPrevious,
  exerciseDurationSeconds,
  findPreviousSets,
  normalizeExerciseName,
  reportVolume,
  setCount,
  topSet,
  trendText,
  type ReportSet,
} from "@/lib/workoutReport";

const set = (reps: number | null, weightKg: number | null = null, seconds: number | null = null, completedAt: string | null = null): ReportSet => ({
  reps,
  weightKg,
  seconds,
  completedAt,
});

describe("workout report", () => {
  it("normalizes exercise names", () => {
    expect(normalizeExerciseName("  Bank  Drücken ")).toBe("bank drücken");
    expect(normalizeExerciseName("KNIEBEUGEN")).toBe(normalizeExerciseName("kniebeugen"));
  });

  it("counts sets and volume (null without weights)", () => {
    const exercises = [
      { name: "Bank", sets: [set(10, 60), set(8, 65)] },
      { name: "Klimmzüge", sets: [set(8)] },
    ];
    expect(setCount(exercises)).toBe(3);
    expect(reportVolume(exercises)).toBe(1120);
    expect(reportVolume([{ name: "Plank", sets: [set(null, null, 60)] }])).toBeNull();
  });

  it("measures an exercise from its first to its last set", () => {
    expect(
      exerciseDurationSeconds([set(10, null, null, "2026-10-22T16:00:00Z"), set(10, null, null, "2026-10-22T16:05:30Z")]),
    ).toBe(330);
    expect(exerciseDurationSeconds([set(10)])).toBe(0);
  });

  it("finds the top set", () => {
    expect(topSet([set(10, 60), set(6, 70), set(8, 70)])).toEqual(set(8, 70));
    expect(topSet([set(12), set(15)])).toEqual(set(15));
    expect(topSet([])).toBeNull();
  });

  it("compares with the last session of the same exercise", () => {
    const earlier = [
      { exercises: [{ name: "Kniebeugen", sets: [set(8, 100)] }] },
      { exercises: [{ name: "Bankdrücken", sets: [set(8, 60)] }] },
    ];
    const previous = findPreviousSets(" bankdrücken", earlier);
    expect(previous).toEqual([set(8, 60)]);
    const comparison = compareToPrevious([set(8, 62.5)], previous);
    expect(comparison).toEqual({ weight: "up", reps: "same", seconds: null });
    expect(trendText(comparison)).toBe("Zur letzten Einheit: Gewicht ↑, Wdh. =");
    expect(findPreviousSets("Rudern", earlier)).toBeNull();
    expect(compareToPrevious([set(8)], null)).toBeNull();
  });

  it("compares time exercises by time", () => {
    const comparison = compareToPrevious([set(null, null, 90)], [set(null, null, 60)]);
    expect(trendText(comparison)).toBe("Zur letzten Einheit: Zeit ↑");
  });
});
