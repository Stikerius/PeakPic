import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { ActivityVisibility, NotCountingReason, WorkoutPayload } from "@/lib/workout";
import type { Json } from "@/types/database";

export type SaveWorkoutResult = {
  id: string;
  countsForStreak: boolean;
  reason: NotCountingReason | null;
  workoutDate: string;
};

type RpcError = { message?: string; hint?: string | null };

export function workoutErrorMessage(error: RpcError): string {
  switch (error.message) {
    case "account_inactive":
      return "Dein Konto ist gerade gesperrt.";
    case "workout_in_future":
      return "Die Zeit des Trainings liegt in der Zukunft. Prüfe die Uhrzeit deines Geräts.";
    case "workout_end_before_start":
    case "invalid_times":
    case "invalid_active_time":
      return "Die Zeiten des Trainings sind ungültig.";
    case "workout_too_long":
      return "Ein Training dauert höchstens 24 Stunden.";
    case "workout_daily_limit":
      return "Höchstens 20 Trainings pro Tag.";
    case "too_many_exercises":
      return "Höchstens 30 Übungen pro Training.";
    case "too_many_sets":
      return "Höchstens 40 Sätze pro Übung.";
    case "plan_day_not_yours":
      return "Der Plantag gehört nicht zu deinen Plänen.";
    default:
      return error.message ?? "Etwas ist schiefgelaufen.";
  }
}

function isReason(value: unknown): value is NotCountingReason {
  return value === "too_short" || value === "too_few_sets" || value === "too_old" || value === "daily_limit";
}

/** Saves the training (atomic, checked by the server). Repeating it returns the same training. */
export async function saveWorkout(payload: WorkoutPayload): Promise<SaveWorkoutResult> {
  const { data, error } = await supabase.rpc("save_workout", { payload: payload as unknown as Json });
  if (error) throw new Error(workoutErrorMessage(error));
  const result = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  return {
    id: typeof result.id === "string" ? result.id : "",
    countsForStreak: result.counts_for_streak === true,
    reason: isReason(result.reason) ? result.reason : null,
    workoutDate: typeof result.workout_date === "string" ? result.workout_date : "",
  };
}

/** Connects a post (the photos of a training) with the training. */
export async function linkWorkoutPost(workoutId: string, postId: string, shareWithPost: boolean): Promise<void> {
  const { error } = await supabase.rpc("link_workout_post", { p_workout_id: workoutId, p_post_id: postId, p_share: shareWithPost });
  if (error) throw new Error(workoutErrorMessage(error));
}

export type WorkoutListItem = {
  id: string;
  title: string;
  workoutDate: string;
  startedAt: string;
  activeSeconds: number;
  visibility: ActivityVisibility;
  countsForStreak: boolean;
  reason: NotCountingReason | null;
  postId: string | null;
};

/** "Wie das Training heisst": own title, plan day or "Freies Training". */
export function workoutTitle(title: string | null, planDayTitle: string | null): string {
  return title ?? planDayTitle ?? "Freies Training";
}

/** My recorded trainings, newest first. */
export async function fetchMyWorkouts(limit = 30): Promise<WorkoutListItem[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("workouts")
    .select("id, title, plan_day_title, workout_date, started_at, active_seconds, visibility, counts_for_streak, not_counting_reason, post_id")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: workoutTitle(row.title, row.plan_day_title),
    workoutDate: row.workout_date,
    startedAt: row.started_at,
    activeSeconds: row.active_seconds,
    visibility: row.visibility,
    countsForStreak: row.counts_for_streak,
    reason: isReason(row.not_counting_reason) ? row.not_counting_reason : null,
    postId: row.post_id,
  }));
}

/** Counting trainings I already have on `day` (for showing the rule before saving). */
export async function countCountingWorkouts(day: string): Promise<number> {
  const userId = await requireUserId();
  const { count, error } = await supabase
    .from("workouts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("workout_date", day)
    .eq("counts_for_streak", true);
  if (error) throw error;
  return count ?? 0;
}

export async function getDefaultActivityVisibility(): Promise<ActivityVisibility> {
  const userId = await requireUserId();
  const { data, error } = await supabase.from("profiles").select("default_activity_visibility").eq("id", userId).single();
  if (error) throw error;
  return data.default_activity_visibility;
}

export async function setDefaultActivityVisibility(value: ActivityVisibility): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("profiles").update({ default_activity_visibility: value }).eq("id", userId);
  if (error) throw error;
}
