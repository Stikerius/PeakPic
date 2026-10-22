import { describe, expect, it } from "@jest/globals";

import {
  canUsePlannedRestDay,
  combineRestDays,
  computeStreakStatsFromDays,
  currentPlanStreak,
  nextPlanDayIndex,
  nextTrainingIndex,
  plannedRestDue,
  restEntryIds,
  type PlanEntry,
  type PlanProof,
} from "@/lib/streak";

// Push, Pull, Ruhetag, Beine, Ruhetag, Ruhetag
const PLAN: PlanEntry[] = [
  { id: "push", type: "training" },
  { id: "pull", type: "training" },
  { id: "rest1", type: "rest" },
  { id: "legs", type: "training" },
  { id: "rest2", type: "rest" },
  { id: "rest3", type: "rest" },
];
const IDS = PLAN.map((e) => e.id);
const REST_IDS = restEntryIds(PLAN);

function training(day: string, planDayId: string | null, time = "18:00"): PlanProof {
  return { day, createdAt: `${day}T${time}:00Z`, planDayId, kind: "training" };
}

function rest(day: string, planDayId: string): PlanProof {
  return { day, createdAt: `${day}T08:00:00Z`, planDayId, kind: "rest" };
}

function due(proofs: PlanProof[], today: string) {
  const trainingDays = new Set(proofs.filter((p) => p.kind !== "rest").map((p) => p.day));
  const restDays = new Set(proofs.filter((p) => p.kind === "rest").map((p) => p.day));
  return plannedRestDue({ entries: PLAN, proofs, today, trainingDays, restDays });
}

describe("planned rest days", () => {
  it("are due the day after the training day before them", () => {
    const proofs = [training("2026-10-19", "push"), training("2026-10-20", "pull")];
    expect(due(proofs, "2026-10-21")).toEqual({ day: "2026-10-21", entryId: "rest1", index: 2 });
    // Yesterday is still allowed, two days later not.
    expect(due(proofs, "2026-10-22")?.day).toBe("2026-10-21");
    expect(due(proofs, "2026-10-23")).toBeNull();
  });

  it("are not due before the training day is done", () => {
    expect(due([training("2026-10-20", "push")], "2026-10-21")).toBeNull();
  });

  it("are refused without any training before them (also right after a plan change)", () => {
    expect(due([], "2026-10-21")).toBeNull();
    // Proofs from before the change are not passed in at all.
    expect(due([rest("2026-10-20", "rest1")], "2026-10-21")).toBeNull();
  });

  it("follow each other on consecutive days", () => {
    const proofs = [training("2026-10-20", "legs")];
    expect(due(proofs, "2026-10-21")?.entryId).toBe("rest2");
    const afterFirst = [...proofs, rest("2026-10-21", "rest2")];
    expect(due(afterFirst, "2026-10-22")).toEqual({ day: "2026-10-22", entryId: "rest3", index: 5 });
    // After the second one the next entry is a training day again.
    expect(due([...afterFirst, rest("2026-10-22", "rest3")], "2026-10-23")).toBeNull();
  });

  it("can't be confirmed on a training day or twice", () => {
    const proofs = [training("2026-10-20", "pull")];
    const input = { entries: PLAN, proofs, today: "2026-10-21" };
    expect(canUsePlannedRestDay("2026-10-21", { ...input, trainingDays: new Set(["2026-10-21"]), restDays: new Set() })).toBe(false);
    expect(canUsePlannedRestDay("2026-10-21", { ...input, trainingDays: new Set(), restDays: new Set(["2026-10-21"]) })).toBe(false);
    expect(canUsePlannedRestDay("2026-10-21", { ...input, trainingDays: new Set(), restDays: new Set() })).toBe(true);
  });

  it("work across month and year boundaries", () => {
    expect(due([training("2026-10-31", "pull")], "2026-11-01")?.day).toBe("2026-11-01");
    expect(due([training("2026-12-31", "legs")], "2027-01-01")?.day).toBe("2027-01-01");
    expect(due([training("2026-12-31", "legs"), rest("2027-01-01", "rest2")], "2027-01-02")?.entryId).toBe("rest3");
  });

  it("keep the normal streak alive without counting", () => {
    const stats = computeStreakStatsFromDays(["2026-10-19", "2026-10-20", "2026-10-22"], "2026-10-22", ["2026-10-21"]);
    expect(stats.current).toBe(3);
    expect(combineRestDays(["2026-10-01", "2026-10-21"], ["2026-10-21", "2026-10-25"])).toEqual([
      "2026-10-01",
      "2026-10-21",
      "2026-10-25",
    ]);
  });
});

describe("plan streak with planned rest days", () => {
  function planStreak(proofs: PlanProof[], today: string) {
    const trainingDays = new Set(proofs.filter((p) => p.kind !== "rest").map((p) => p.day));
    const restDays = new Set(proofs.filter((p) => p.kind === "rest").map((p) => p.day));
    return currentPlanStreak({ planDayIds: IDS, proofs, trainingDays, restDays, today, restIds: REST_IDS });
  }

  it("counts training days in order and bridges confirmed rest days", () => {
    const proofs = [
      training("2026-10-19", "push"),
      training("2026-10-20", "pull"),
      rest("2026-10-21", "rest1"),
      training("2026-10-22", "legs"),
    ];
    expect(planStreak(proofs, "2026-10-22")).toBe(3);
    expect(nextPlanDayIndex(IDS, proofs)).toBe(4);
  });

  it("accepts training on instead of resting (the rest day is skipped)", () => {
    const proofs = [training("2026-10-19", "push"), training("2026-10-20", "pull"), training("2026-10-21", "legs")];
    expect(planStreak(proofs, "2026-10-21")).toBe(3);
  });

  it("still ends with a wrong training day", () => {
    const proofs = [training("2026-10-19", "push"), training("2026-10-20", "legs")];
    expect(planStreak(proofs, "2026-10-20")).toBe(0);
  });

  it("picks the next training day for a post when a rest day is due", () => {
    expect(nextTrainingIndex(PLAN, 2)).toBe(3);
    expect(nextTrainingIndex(PLAN, 4)).toBe(0);
    expect(nextTrainingIndex(PLAN, 1)).toBe(1);
  });
});
