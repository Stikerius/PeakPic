import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import type { DayKey } from "@/lib/streak";
import { fetchWorkoutDays } from "@/lib/workoutDaysRepo";

type UseWorkoutDaysResult = {
  /** Own and shared training days. */
  days: DayKey[];
  /** Days that come from someone else's post I'm linked to. */
  sharedDays: ReadonlySet<DayKey>;
  restDays: DayKey[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Loads the user's training days and reloads whenever the screen regains focus. */
export function useWorkoutDays(): UseWorkoutDaysResult {
  const [days, setDays] = useState<DayKey[]>([]);
  const [sharedDays, setSharedDays] = useState<ReadonlySet<DayKey>>(new Set());
  const [restDays, setRestDays] = useState<DayKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Returns a cleanup that ignores late results; reload() calls it directly.
  const load = useCallback(() => {
    let active = true;
    fetchWorkoutDays()
      .then((result) => {
        if (!active) return;
        setDays(result.days);
        setSharedDays(new Set(result.shared.map((s) => s.day)));
        setRestDays(result.restDays);
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
  }, []);

  useFocusEffect(load);

  return { days, sharedDays, restDays, loading, error, reload: () => void load() };
}
