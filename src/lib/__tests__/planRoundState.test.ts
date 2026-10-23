import { describe, expect, it } from "@jest/globals";

import { deviationProposal, plannedRestDueFromRound, roundNext, roundSteps, type PlanRoundState } from "@/lib/planRoundState";
import type { PlanEntry } from "@/lib/streak";

const ENTRIES: PlanEntry[] = [
  { id: "push", type: "training" },
  { id: "pull", type: "training" },
  { id: "rest", type: "rest" },
  { id: "legs", type: "training" },
];

function state(dayOrder: string[], nextIndex: number, lastDay: string | null = null): PlanRoundState {
  return { planId: "p", dayOrder, nextIndex, lastDay, pending: null };
}

describe("round state", () => {
  it("shows done, next and open", () => {
    expect(roundSteps(state(["push", "pull", "rest", "legs"], 1)).map((s) => s.status)).toEqual(["done", "next", "open", "open"]);
  });

  it("finds the next unit and the next training in the round's own order", () => {
    // Round order changed for this round only: Push done, then Legs, Rest, Pull.
    const s = state(["push", "legs", "rest", "pull"], 1);
    expect(ENTRIES[roundNext(s, ENTRIES).nextIndex]?.id).toBe("legs");
    const atRest = state(["push", "legs", "rest", "pull"], 2);
    expect(ENTRIES[roundNext(atRest, ENTRIES).nextIndex]?.id).toBe("rest");
    expect(ENTRIES[roundNext(atRest, ENTRIES).nextTrainingIndex]?.id).toBe("pull");
    expect(roundNext(null, ENTRIES)).toEqual({ nextIndex: 0, nextTrainingIndex: 0 });
  });

  it("offers a planned rest day only the day after the last plan entry", () => {
    const s = state(["push", "pull", "rest", "legs"], 2, "2026-10-21");
    expect(plannedRestDueFromRound(s, ENTRIES, "2026-10-22", new Set(), new Set())).toEqual({ day: "2026-10-22", entryId: "rest", index: 2 });
    expect(plannedRestDueFromRound(s, ENTRIES, "2026-10-24", new Set(), new Set())).toBeNull();
    expect(plannedRestDueFromRound(s, ENTRIES, "2026-10-22", new Set(["2026-10-22"]), new Set())).toBeNull();
    expect(plannedRestDueFromRound(state(["push", "pull", "rest", "legs"], 1, "2026-10-21"), ENTRIES, "2026-10-22", new Set(), new Set())).toBeNull();
  });

  it("proposes: the trained unit is done, the others keep their order", () => {
    const s = state(["push", "pull", "rest", "legs"], 1);
    expect(deviationProposal(s, "legs")).toEqual(["pull", "rest"]);
    // A unit that was already done (trained again): the open units stay as they are.
    expect(deviationProposal(s, "push")).toEqual(["pull", "rest", "legs"]);
  });
});
