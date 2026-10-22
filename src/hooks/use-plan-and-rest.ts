import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { fetchMyPlan, fetchPlanProofs, type TrainingPlan } from "@/lib/planRepo";
import { fetchMyRestDays, type MyRestDays } from "@/lib/restRepo";
import type { PlanProof } from "@/lib/streak";

type PlanAndRest = {
  /** null: no plan (nothing about plans is shown). */
  plan: TrainingPlan | null;
  /** Own proofs since the plan's order last changed. */
  proofs: PlanProof[];
  rest: MyRestDays;
  reload: () => void;
};

const NO_REST: MyRestDays = { budget: null, uses: [], planned: [] };

/**
 * My plan, plan proofs and rest days, reloaded when the screen regains focus. Failures leave
 * the optional features hidden instead of blocking the screen.
 */
export function usePlanAndRest(): PlanAndRest {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [proofs, setProofs] = useState<PlanProof[]>([]);
  const [rest, setRest] = useState<MyRestDays>(NO_REST);

  // Returns a cleanup that ignores late results; reload() calls it directly.
  const load = useCallback(() => {
    let active = true;
    Promise.all([fetchMyPlan(), fetchPlanProofs(), fetchMyRestDays()])
      .then(([myPlan, myProofs, myRest]) => {
        if (!active) return;
        setPlan(myPlan);
        setProofs(myProofs);
        setRest(myRest);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  return { plan, proofs, rest, reload: () => void load() };
}
