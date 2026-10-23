import { describe, expect, it } from "@jest/globals";

import { correctPlanDays, nextPlanDayIndex, planRound, type PlanEntry, type PlanProof } from "@/lib/streak";

const t = (id: string): PlanEntry => ({ id, type: "training" });
const r = (id: string): PlanEntry => ({ id, type: "rest" });

function proof(day: string, planDayId: string | null, kind: "training" | "rest" = "training"): PlanProof {
  return { day, createdAt: `${day}T18:00:00Z`, planDayId, kind };
}

const PLAN = [t("push"), t("pull"), t("legs")];
const ids = (entries: PlanEntry[]) => entries.map((e) => e.id);

describe("plan round: progress by day id", () => {
  it("starts at day 1 and moves on", () => {
    expect(planRound(PLAN, []).nextIndex).toBe(0);
    expect(planRound(PLAN, [proof("2026-10-20", "push")]).nextIndex).toBe(1);
  });

  it("reordering an active plan resets nothing: done stays done, next is the first open unit", () => {
    const proofs = [proof("2026-10-20", "push")];
    const reordered = [t("legs"), t("push"), t("pull")];
    const round = planRound(reordered, proofs);
    expect([...round.done]).toEqual(["push"]);
    expect(reordered[round.nextIndex]?.id).toBe("legs");
    // Push now sits in the middle and is still done: after Legs comes Pull.
    const after = planRound(reordered, [...proofs, proof("2026-10-21", "legs")]);
    expect(reordered[after.nextIndex]?.id).toBe("pull");
  });

  it("keeps progress when days are added or removed", () => {
    const proofs = [proof("2026-10-20", "push")];
    const added = [t("push"), t("core"), t("pull"), t("legs")];
    expect(added[planRound(added, proofs).nextIndex]?.id).toBe("core");
    // The next day (pull) was deleted: the following one moves up.
    const removed = [t("push"), t("legs")];
    expect(removed[planRound(removed, proofs).nextIndex]?.id).toBe("legs");
  });

  it("starts a new round in the plan's order after the last open unit", () => {
    const proofs = [proof("2026-10-18", "push"), proof("2026-10-19", "pull"), proof("2026-10-20", "legs")];
    const round = planRound(PLAN, proofs);
    expect(round.done.size).toBe(0);
    expect(round.nextIndex).toBe(0);
    expect(round.lastDay).toBe("2026-10-20");
  });

  it("training instead of a due rest day skips it; the next training ignores done units", () => {
    const plan = [t("push"), r("rest"), t("pull"), t("legs")];
    const skipped = planRound(plan, [proof("2026-10-20", "push"), proof("2026-10-21", "pull")]);
    expect(plan[skipped.nextIndex]?.id).toBe("legs");
    expect(correctPlanDays(ids(plan), [proof("2026-10-20", "push"), proof("2026-10-21", "pull")], new Set(["rest"])).size).toBe(2);
    // Legs out of order: the next training is Pull (Push and Legs are done), not Push.
    const outOfOrder = planRound(plan, [proof("2026-10-20", "push"), proof("2026-10-21", "legs")]);
    expect(plan[outOfOrder.nextIndex]?.id).toBe("rest");
    expect(plan[outOfOrder.nextTrainingIndex]?.id).toBe("pull");
  });

  it("ignores proofs of days that aren't in the plan (any more)", () => {
    expect(nextPlanDayIndex(ids(PLAN), [proof("2026-10-20", "gone"), proof("2026-10-21", null)])).toBe(0);
  });
});
