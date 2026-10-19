import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { workoutRepo } from "@/lib/workoutRepo";
import type { Workout } from "@/types/workout";

type UseWorkoutsResult = {
  workouts: Workout[];
  loading: boolean;
  error: string | null;
};

/** Loads the user's workouts and reloads whenever the screen regains focus. */
export function useWorkouts(): UseWorkoutsResult {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      workoutRepo
        .listWorkouts()
        .then((result) => {
          if (!active) return;
          setWorkouts(result);
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

  return { workouts, loading, error };
}
