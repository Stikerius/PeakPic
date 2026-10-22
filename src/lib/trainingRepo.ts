import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { ActivityVisibility, NotCountingReason, WorkoutPayload } from "@/lib/workout";
import { reportVolume, type ReportExercise } from "@/lib/workoutReport";
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
    case "workout_has_post":
      return "Dieses Training hat schon einen Beitrag.";
    case "workout_not_found":
      return "Training nicht gefunden.";
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
  userId: string;
  title: string;
  workoutDate: string;
  startedAt: string;
  activeSeconds: number;
  visibility: ActivityVisibility;
  countsForStreak: boolean;
  reason: NotCountingReason | null;
  postId: string | null;
  planDayId: string | null;
  volumeKg: number | null;
};

/** "Wie das Training heisst": own title, plan day or "Freies Training". */
export function workoutTitle(title: string | null, planDayTitle: string | null): string {
  return title ?? planDayTitle ?? "Freies Training";
}

type SetRow = { reps: number | null; weight_kg: number | string | null; seconds: number | null; completed_at: string | null };
type ExerciseRow = { name: string; position: number; sets: (SetRow & { position: number })[] };

function toExercises(rows: ExerciseRow[]): ReportExercise[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((e) => ({
      name: e.name,
      sets: [...e.sets]
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          reps: s.reps,
          // numeric arrives as a string from PostgREST.
          weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
          seconds: s.seconds,
          completedAt: s.completed_at,
        })),
    }));
}

const LIST_SELECT =
  "id, user_id, title, plan_day_id, plan_day_title, workout_date, started_at, active_seconds, visibility, counts_for_streak, not_counting_reason, post_id, " +
  "exercises:workout_exercises(name, position, sets:workout_sets(position, reps, weight_kg, seconds, completed_at))";

type ListRow = {
  id: string;
  user_id: string;
  title: string | null;
  plan_day_id: string | null;
  plan_day_title: string | null;
  workout_date: string;
  started_at: string;
  active_seconds: number;
  visibility: ActivityVisibility;
  counts_for_streak: boolean;
  not_counting_reason: string | null;
  post_id: string | null;
  exercises: ExerciseRow[];
};

function toListItem(row: ListRow): WorkoutListItem {
  return {
    id: row.id,
    userId: row.user_id,
    title: workoutTitle(row.title, row.plan_day_title),
    workoutDate: row.workout_date,
    startedAt: row.started_at,
    activeSeconds: row.active_seconds,
    visibility: row.visibility,
    countsForStreak: row.counts_for_streak,
    reason: isReason(row.not_counting_reason) ? row.not_counting_reason : null,
    postId: row.post_id,
    planDayId: row.plan_day_id,
    volumeKg: reportVolume(toExercises(row.exercises)),
  };
}

/** Trainings of `userId` the caller may see (the database decides), newest first. */
export async function fetchWorkoutsOf(userId: string, limit = 50): Promise<WorkoutListItem[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select(LIST_SELECT)
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as ListRow[]).map(toListItem);
}

/** My recorded trainings, newest first. */
export async function fetchMyWorkouts(limit = 30): Promise<WorkoutListItem[]> {
  return fetchWorkoutsOf(await requireUserId(), limit);
}

export type WorkoutReport = WorkoutListItem & {
  note: string | null;
  planDayTitle: string | null;
  endedAt: string;
  shareWithPost: boolean;
  exercises: ReportExercise[];
};

/** One training with all exercises and sets, or null if it doesn't exist or I may not see it. */
export async function fetchWorkoutReport(id: string): Promise<WorkoutReport | null> {
  const { data, error } = await supabase
    .from("workouts")
    .select(`${LIST_SELECT}, note, ended_at, share_with_post`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  const row = data as unknown as ListRow & { note: string | null; ended_at: string; share_with_post: boolean };
  return {
    ...toListItem(row),
    note: row.note,
    planDayTitle: row.plan_day_title,
    endedAt: row.ended_at,
    shareWithPost: row.share_with_post,
    exercises: toExercises(row.exercises),
  };
}

/** Earlier trainings of the same person (newest first), for "zur letzten Einheit". */
export async function fetchEarlierWorkouts(userId: string, before: string, limit = 30): Promise<{ exercises: ReportExercise[] }[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("started_at, exercises:workout_exercises(name, position, sets:workout_sets(position, reps, weight_kg, seconds, completed_at))")
    .eq("user_id", userId)
    .lt("started_at", before)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as { exercises: ExerciseRow[] }[]).map((row) => ({ exercises: toExercises(row.exercises) }));
}

/** The training shown with a post ("Trainingsbericht beim Beitrag zeigen"), if I may see it. */
export async function fetchWorkoutIdForPost(postId: string): Promise<string | null> {
  const { data, error } = await supabase.from("workouts").select("id").eq("post_id", postId).limit(1).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function setWorkoutVisibility(id: string, visibility: ActivityVisibility): Promise<void> {
  const { error } = await supabase.rpc("set_workout_visibility", { p_workout_id: id, p_visibility: visibility });
  if (error) throw new Error(workoutErrorMessage(error));
}

/** Deletes one of my trainings (a linked post stays). */
export async function deleteWorkout(id: string): Promise<void> {
  const { error } = await supabase.from("workouts").delete().eq("id", id);
  if (error) throw error;
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
