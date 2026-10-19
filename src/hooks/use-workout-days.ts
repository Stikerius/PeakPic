import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import type { DayKey } from "@/lib/streak";
import { workoutRepo } from "@/lib/workoutRepo";

type UseWorkoutDaysResult = {
  days: DayKey[];
  loading: boolean;
  error: string | null;
};

/** Loads the user's training days and reloads whenever the screen regains focus. */
export function useWorkoutDays(): UseWorkoutDaysResult {
  const [days, setDays] = useState<DayKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      workoutRepo
        .listWorkoutDays()
        .then((result) => {
          if (!active) return;
          setDays(result);
          setError(null);
        })
        .catch(() => {
          if (active) setError("Trainings konnten nicht geladen werden.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  return { days, loading, error };
}
