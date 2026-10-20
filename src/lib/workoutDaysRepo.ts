import { requireUserId } from "@/lib/session";
import { combineTrainingDays, type DayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";

/** A training day that comes from someone else's post the user was linked to. */
export type SharedWorkoutDay = { day: DayKey; postId: string; ownerId: string };

export type WorkoutDays = {
  /** All training days (own and shared), each once. */
  days: DayKey[];
  shared: SharedWorkoutDay[];
};

/**
 * Training days of a user from the database's workout_days(): own posts that count as a
 * training proof plus accepted workout links. Which posts count is decided there
 * (post_counts_as_workout), so app and database agree.
 */
export async function fetchWorkoutDays(userId?: string): Promise<WorkoutDays> {
  const target = userId ?? (await requireUserId());
  const { data, error } = await supabase.rpc("workout_days", { target });
  if (error) throw error;
  const own: DayKey[] = [];
  const shared: SharedWorkoutDay[] = [];
  for (const row of data) {
    if (row.shared_by === null) own.push(row.day);
    else shared.push({ day: row.day, postId: row.post_id, ownerId: row.shared_by });
  }
  return { days: combineTrainingDays(own, shared.map((s) => s.day)), shared };
}
