import { describe, expect, it } from "@jest/globals";

import {
  exerciseSummary,
  formatReps,
  formatTime,
  moveItem,
  originLabel,
  parseReps,
  parseTime,
  parseWeight,
  planDraftError,
  suggestNames,
  toDayPayloads,
  type DayDraft,
  type ExerciseDraft,
} from "@/lib/planDraft";

function exercise(change: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return { key: "e", id: null, name: "Bankdrücken", sets: "3", reps: "8-12", time: "", weight: "", notes: "", ...change };
}

function day(change: Partial<DayDraft> = {}): DayDraft {
  return { key: "d", id: null, type: "training", title: "Push", notes: "", exercises: [exercise()], ...change };
}

describe("parsing", () => {
  it("reads times as mm:ss or seconds", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime("1:30")).toBe(90);
    expect(parseTime("90")).toBe(90);
    expect(parseTime("1:75")).toBeNaN();
    expect(parseTime("abc")).toBeNaN();
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(5)).toBe("0:05");
  });

  it("reads reps as a number or a range", () => {
    expect(parseReps("8")).toEqual({ min: 8, max: null });
    expect(parseReps("8-12")).toEqual({ min: 8, max: 12 });
    expect(parseReps("8 – 12")).toEqual({ min: 8, max: 12 });
    expect(parseReps("10-10")).toEqual({ min: 10, max: null });
    expect(parseReps("12-8")).toBeUndefined();
    expect(parseReps("0")).toBeUndefined();
    expect(parseReps("")).toBeNull();
    expect(formatReps(8, 12)).toBe("8-12");
    expect(formatReps(8, null)).toBe("8");
  });

  it("reads weights with comma or point", () => {
    expect(parseWeight("82,5")).toBe(82.5);
    expect(parseWeight("100")).toBe(100);
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("1,234")).toBeNaN();
  });
});

describe("planDraftError", () => {
  it("accepts a valid plan with a rest day", () => {
    expect(planDraftError("PPL", [day(), day({ type: "rest", title: "Ruhetag", exercises: [] })])).toBeNull();
  });

  it("needs a name, a training day and named days", () => {
    expect(planDraftError(" ", [day()])).toMatch(/Namen/);
    expect(planDraftError("PPL", [day({ type: "rest", title: "Ruhe", exercises: [] })])).toMatch(/Trainingstag/);
    expect(planDraftError("PPL", [day({ title: " " })])).toMatch(/Tag 1/);
  });

  it("checks exercises", () => {
    expect(planDraftError("P", [day({ exercises: [exercise({ sets: "0" })] })])).toMatch(/Sätze/);
    expect(planDraftError("P", [day({ exercises: [exercise({ reps: "", time: "" })] })])).toMatch(/Wiederholungen oder Zeit/);
    expect(planDraftError("P", [day({ exercises: [exercise({ reps: "", time: "1:00" })] })])).toBeNull();
    expect(planDraftError("P", [day({ exercises: [exercise({ time: "61:00" })] })])).toMatch(/Zeit/);
    expect(planDraftError("P", [day({ exercises: [exercise({ weight: "1001" })] })])).toMatch(/Gewicht/);
    const many = Array.from({ length: 21 }, () => exercise());
    expect(planDraftError("P", [day({ exercises: many })])).toMatch(/20 Übungen/);
  });

  it("ignores exercises of rest days", () => {
    expect(
      planDraftError("P", [day(), day({ type: "rest", title: "Ruhe", exercises: [exercise({ sets: "x" })] })]),
    ).toBeNull();
  });
});

describe("toDayPayloads", () => {
  it("converts fields and drops exercises of rest days", () => {
    const payload = toDayPayloads([
      day({ exercises: [exercise({ reps: "8-12", time: "0:45", weight: "60,5", notes: " langsam " })] }),
      day({ type: "rest", title: "Ruhetag", exercises: [exercise()] }),
    ]);
    expect(payload[0]?.exercises[0]).toEqual({
      id: null,
      name: "Bankdrücken",
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      target_seconds: 45,
      target_weight_kg: 60.5,
      notes: "langsam",
    });
    expect(payload[1]?.exercises).toEqual([]);
    expect(payload[1]?.notes).toBeNull();
  });
});

describe("helpers", () => {
  it("summarises an exercise", () => {
    expect(exerciseSummary({ sets: 3, repsMin: 8, repsMax: 12, targetSeconds: null, targetWeightKg: 60 })).toBe("3 × 8-12 · 60 kg");
    expect(exerciseSummary({ sets: 3, repsMin: null, repsMax: null, targetSeconds: 45, targetWeightKg: null })).toBe("3 × 0:45");
  });

  it("suggests earlier names, prefix matches first, without duplicates", () => {
    const known = ["Kniebeugen", "Bankdrücken", "Schrägbankdrücken", "bankdrücken", "Klimmzüge"];
    expect(suggestNames("bank", known)).toEqual(["Bankdrücken", "Schrägbankdrücken"]);
    expect(suggestNames("", known)).toEqual([]);
    expect(suggestNames("Klimmzüge", known)).toEqual([]);
  });

  it("labels the origin of adopted plans", () => {
    expect(originLabel(null, "u1", "anna")).toBeNull();
    expect(originLabel("2026-10-22T10:00:00Z", "u1", "anna")).toBe("Übernommen von @anna");
    expect(originLabel("2026-10-22T10:00:00Z", null, null)).toBe("Übernommen von: Gelöschtes Konto");
    expect(originLabel("2026-10-22T10:00:00Z", "u1", null)).toBe("Übernommen von: Konto nicht verfügbar");
  });

  it("moves items", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });
});
