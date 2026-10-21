import { describe, expect, it } from "@jest/globals";

import {
  canUseRestDay,
  computeStreakStatsFromDays,
  currentPlanStreak,
  currentStreak,
  nextPlanDayIndex,
  restStatus,
  restWeek,
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
  // Set on Thursday 2026-10-01: 2 rest days per week.
  const budget = { restsPerWeek: 2, cycleStart: "2026-10-01" };

  it("runs per calendar week, Monday to Sunday", () => {
    // 2026-10-21 is a Wednesday.
    expect(restWeek("2026-10-21")).toEqual({ start: "2026-10-19", end: "2026-10-26" });
    expect(restWeek("2026-10-19")).toEqual({ start: "2026-10-19", end: "2026-10-26" });
    expect(restWeek("2026-10-25")).toEqual({ start: "2026-10-19", end: "2026-10-26" });
    // Across a year boundary: Thursday 2027-01-01 belongs to the week of Monday 2026-12-28.
    expect(restWeek("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-04" });
  });

  it("counts only uses of the current week, nothing carries over", () => {
    const uses = ["2026-10-20", "2026-10-25"];
    expect(restStatus(budget, uses, "2026-10-25").remaining).toBe(0);
    // Monday starts a new week: the full budget again, unused days are gone.
    expect(restStatus(budget, uses, "2026-10-26").remaining).toBe(2);
  });

  it("can change its number only 21 days after it was set (time limit after 3 weeks)", () => {
    expect(restStatus(budget, [], "2026-10-21").changeableFrom).toBe("2026-10-22");
  });

  it("allows a rest day only for today or yesterday, without training, within the budget", () => {
    const training = new Set(["2026-10-20"]);
    expect(canUseRestDay("2026-10-19", "2026-10-20", budget, [], training)).toBe(true);
    expect(canUseRestDay("2026-10-18", "2026-10-20", budget, [], training)).toBe(false);
    expect(canUseRestDay("2026-10-20", "2026-10-20", budget, [], training)).toBe(false);
    // One rest day per week, already used on Tuesday: nothing left for Monday.
    expect(canUseRestDay("2026-10-19", "2026-10-20", { ...budget, restsPerWeek: 1 }, ["2026-10-20"], new Set())).toBe(false);
    expect(canUseRestDay("2026-10-19", "2026-10-20", budget, ["2026-10-12", "2026-10-13"], training)).toBe(true);
    expect(canUseRestDay("2026-10-19", "2026-10-20", null, [], training)).toBe(false);
  });

  it("uses the budget of the week the day belongs to", () => {
    // Yesterday (Sunday) is the last day of a used-up week, today (Monday) starts a fresh one.
    const uses = ["2026-10-20", "2026-10-21"];
    expect(canUseRestDay("2026-10-25", "2026-10-26", budget, uses, new Set())).toBe(false);
    expect(canUseRestDay("2026-10-26", "2026-10-26", budget, uses, new Set())).toBe(true);
  });
});
