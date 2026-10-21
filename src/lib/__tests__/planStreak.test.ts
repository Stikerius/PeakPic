import { describe, expect, it } from "@jest/globals";

import {
  canUseRestDay,
  computeStreakStatsFromDays,
  currentPlanStreak,
  currentStreak,
  nextPlanDayIndex,
  restPeriod,
  restStatus,
  runLengthByDay,
  type PlanProof,
} from "@/lib/streak";

const PUSH = "push";
const PULL = "pull";
const LEGS = "legs";
const PLAN = [PUSH, PULL, LEGS];

function proof(day: string, planDayId: string | null, time = "18:00"): PlanProof {
  return { day, createdAt: `${day}T${time}:00Z`, planDayId };
}

function planStreak(proofs: PlanProof[], today: string, restDays: string[] = [], extraTrainingDays: string[] = []) {
  return currentPlanStreak({
    planDayIds: PLAN,
    proofs,
    trainingDays: new Set([...proofs.map((p) => p.day), ...extraTrainingDays]),
    restDays: new Set(restDays),
    today,
  });
}

describe("rest days in the normal streak", () => {
  it("bridge a gap without counting as a training day", () => {
    const days = new Set(["2026-10-17", "2026-10-18", "2026-10-20"]);
    expect(currentStreak(days, "2026-10-20")).toBe(1);
    expect(currentStreak(days, "2026-10-20", new Set(["2026-10-19"]))).toBe(3);
  });

  it("keep a streak alive when the rest day is yesterday and today is still open", () => {
    expect(currentStreak(new Set(["2026-10-18"]), "2026-10-20", new Set(["2026-10-19"]))).toBe(1);
  });

  it("count a rest day on a training day only once (as the training day)", () => {
    const days = new Set(["2026-10-19", "2026-10-20"]);
    expect(currentStreak(days, "2026-10-20", new Set(["2026-10-20"]))).toBe(2);
    expect(computeStreakStatsFromDays([...days], "2026-10-20", ["2026-10-19", "2026-10-20"]).longest).toBe(2);
  });

  it("don't get a flame in the calendar", () => {
    const runs = runLengthByDay(new Set(["2026-10-18", "2026-10-20"]), new Set(["2026-10-19"]));
    expect(runs.has("2026-10-19")).toBe(false);
    expect(runs.get("2026-10-20")).toBe(2);
  });

  it("bridge month and year boundaries", () => {
    const days = new Set(["2026-12-30", "2027-01-01"]);
    expect(currentStreak(days, "2027-01-01", new Set(["2026-12-31"]))).toBe(2);
    expect(currentStreak(new Set(["2027-02-28", "2027-03-02"]), "2027-03-02", new Set(["2027-03-01"]))).toBe(2);
  });
});

describe("plan streak", () => {
  it("counts days on which the due unit was trained", () => {
    const proofs = [proof("2026-10-18", PUSH), proof("2026-10-19", PULL), proof("2026-10-20", LEGS)];
    expect(planStreak(proofs, "2026-10-20")).toBe(3);
  });

  it("goes on through the end of the cycle (cycle wrap)", () => {
    const proofs = [
      proof("2026-10-16", PUSH),
      proof("2026-10-17", PULL),
      proof("2026-10-18", LEGS),
      proof("2026-10-19", PUSH),
      proof("2026-10-20", PULL),
    ];
    expect(planStreak(proofs, "2026-10-20")).toBe(5);
    expect(nextPlanDayIndex(PLAN, proofs)).toBe(2);
  });

  it("ends on a unit in the wrong order and restarts with the next correct one", () => {
    const proofs = [
      proof("2026-10-17", PUSH),
      proof("2026-10-18", LEGS), // Pull was due
      proof("2026-10-19", PUSH), // after Legs, Push is due again
      proof("2026-10-20", PULL),
    ];
    expect(planStreak(proofs, "2026-10-20")).toBe(2);
  });

  it("ends on a proof without assignment, which still counts for the normal streak", () => {
    const proofs = [proof("2026-10-18", PUSH), proof("2026-10-19", null), proof("2026-10-20", PULL)];
    expect(planStreak(proofs, "2026-10-20")).toBe(1);
    expect(currentStreak(new Set(proofs.map((p) => p.day)), "2026-10-20")).toBe(3);
  });

  it("needs every proof of a day to be in order", () => {
    const twoInOrder = [proof("2026-10-20", PUSH, "08:00"), proof("2026-10-20", PULL, "18:00")];
    expect(planStreak(twoInOrder, "2026-10-20")).toBe(1);
    const secondWrong = [proof("2026-10-20", PUSH, "08:00"), proof("2026-10-20", PUSH, "18:00")];
    expect(planStreak(secondWrong, "2026-10-20")).toBe(0);
  });

  it("is bridged by rest days like the normal streak", () => {
    const proofs = [proof("2026-10-18", PUSH), proof("2026-10-20", PULL)];
    expect(planStreak(proofs, "2026-10-20")).toBe(1);
    expect(planStreak(proofs, "2026-10-20", ["2026-10-19"])).toBe(2);
  });

  it("ends on a day that only counts through someone else's linked post", () => {
    const proofs = [proof("2026-10-18", PUSH), proof("2026-10-20", PULL)];
    expect(planStreak(proofs, "2026-10-20", [], ["2026-10-19"])).toBe(1);
  });

  it("restarts at unit 1 after a plan change (only proofs since then are passed in)", () => {
    // Before the change: Push, Pull. The new plan starts again with its first unit.
    expect(nextPlanDayIndex(PLAN, [])).toBe(0);
    const sinceChange = [proof("2026-10-20", PUSH)];
    // 2026-10-19 was a training day before the change: it doesn't count for the new plan.
    expect(planStreak(sinceChange, "2026-10-20", [], ["2026-10-19"])).toBe(1);
  });

  it("works across month and year boundaries", () => {
    const proofs = [proof("2026-12-31", PUSH), proof("2027-01-01", PULL)];
    expect(planStreak(proofs, "2027-01-01")).toBe(2);
  });

  it("keeps the plan streak of yesterday while today is still open", () => {
    const proofs = [proof("2026-10-19", PUSH)];
    expect(planStreak(proofs, "2026-10-20")).toBe(1);
  });
});

describe("rest day budget", () => {
  const budget = { restsPerPeriod: 2, cycleStart: "2026-10-01" };

  it("runs in 21-day periods from the day it was set", () => {
    expect(restPeriod("2026-10-01", "2026-10-21")).toEqual({ start: "2026-10-01", end: "2026-10-22" });
    expect(restPeriod("2026-10-01", "2026-10-22")).toEqual({ start: "2026-10-22", end: "2026-11-12" });
  });

  it("counts only uses of the current period, nothing carries over", () => {
    const uses = ["2026-10-05", "2026-10-21"];
    expect(restStatus(budget, uses, "2026-10-21").remaining).toBe(0);
    // Day 22 starts a new period: the full budget again, unused days are gone.
    expect(restStatus(budget, uses, "2026-10-22").remaining).toBe(2);
  });

  it("can be changed again only after 21 days", () => {
    expect(restStatus(budget, [], "2026-10-21").changeableFrom).toBe("2026-10-22");
  });

  it("allows a rest day only for today or yesterday, without training, within the budget", () => {
    const training = new Set(["2026-10-20"]);
    expect(canUseRestDay("2026-10-19", "2026-10-20", budget, [], training)).toBe(true);
    expect(canUseRestDay("2026-10-18", "2026-10-20", budget, [], training)).toBe(false);
    expect(canUseRestDay("2026-10-20", "2026-10-20", budget, [], training)).toBe(false);
    expect(canUseRestDay("2026-10-19", "2026-10-20", budget, ["2026-10-02", "2026-10-03"], training)).toBe(false);
    expect(canUseRestDay("2026-10-19", "2026-10-20", null, [], training)).toBe(false);
  });

  it("uses the budget of the period the day belongs to", () => {
    // Yesterday is the last day of a used-up period, today starts a fresh one.
    const uses = ["2026-10-05", "2026-10-06"];
    expect(canUseRestDay("2026-10-21", "2026-10-22", budget, uses, new Set())).toBe(false);
    expect(canUseRestDay("2026-10-22", "2026-10-22", budget, uses, new Set())).toBe(true);
  });
});
