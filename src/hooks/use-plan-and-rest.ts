import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { fetchMyPlan, fetchMyPlanRound, fetchPlanProofs, type MyPlanRound, type TrainingPlan } from "@/lib/planRepo";
import { fetchMyRestDays, type MyRestDays } from "@/lib/restRepo";
import type { PlanProof } from "@/lib/streak";

type PlanAndRest = {
  /** null: no plan (nothing about plans is shown). */
  plan: TrainingPlan | null;
  /** Own proofs since the plan's order last changed. */
  proofs: PlanProof[];
  rest: MyRestDays;
  /** The stored round of the active plan and the open question. */
  round: MyPlanRound;
  reload: () => void;
};

const NO_REST: MyRestDays = { budget: null, uses: [], planned: [] };
const NO_ROUND: MyPlanRound = { round: null, autoResolved: [] };

/**
 * My plan, plan proofs and rest days, reloaded when the screen regains focus. Failures leave
 * the optional features hidden instead of blocking the screen.
 */
export function usePlanAndRest(): PlanAndRest {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [proofs, setProofs] = useState<PlanProof[]>([]);
  const [rest, setRest] = useState<MyRestDays>(NO_REST);
  const [round, setRound] = useState<MyPlanRound>(NO_ROUND);

  // Returns a cleanup that ignores late results; reload() calls it directly.
  const load = useCallback(() => {
    let active = true;
    Promise.all([fetchMyPlan(), fetchPlanProofs(), fetchMyRestDays(), fetchMyPlanRound().catch(() => NO_ROUND)])
      .then(([myPlan, myProofs, myRest, myRound]) => {
        if (!active) return;
        setPlan(myPlan);
        setProofs(myProofs);
        setRest(myRest);
        setRound(myRound);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  return { plan, proofs, rest, round, reload: () => void load() };
}
