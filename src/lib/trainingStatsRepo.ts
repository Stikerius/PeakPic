import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { mergeExercises, type ExercisePoint, type PlanDayCount, type StatsDay, type StatsRange, type TrainingStats } from "@/lib/trainingStats";
import type { ActivityVisibility } from "@/lib/workout";
import type { Json } from "@/types/database";

type JsonObject = { [key: string]: Json };

function asObject(value: Json | undefined): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function asArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

/** Numbers from the database (numeric may come as a string); null stays null. */
function num(value: Json | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function str(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function parseStats(data: Json): TrainingStats | null {
  const root = asObject(data);
  if (root === null) return null;
  const range = root.range;
  const bucket = root.bucket;
  if ((range !== "weeks" && range !== "months" && range !== "year") || (bucket !== "week" && bucket !== "month")) return null;
  const days: StatsDay[] = asArray(root.days).flatMap((item) => {
    const d = asObject(item);
    if (d === null) return [];
    return [{ day: str(d.day), workouts: num(d.workouts) ?? 0, activeSeconds: num(d.active_seconds) ?? 0, sets: num(d.sets) ?? 0, volumeKg: num(d.volume_kg) }];
  });
  const exercises = asArray(root.exercises).flatMap((item) => {
    const e = asObject(item);
    if (e === null) return [];
    const points: ExercisePoint[] = asArray(e.points).flatMap((raw) => {
      const p = asObject(raw);
      if (p === null) return [];
      return [
        {
          day: str(p.day),
          bestWeightKg: num(p.best_weight_kg),
          bestWeightReps: num(p.best_weight_reps),
          bestE1rmKg: num(p.best_e1rm_kg),
          volumeKg: num(p.volume_kg),
          totalReps: num(p.total_reps),
          maxReps: num(p.max_reps),
          totalSeconds: num(p.total_seconds),
          maxSeconds: num(p.max_seconds),
        },
      ];
    });
    return [{ key: str(e.key), name: str(e.name), sessions: num(e.sessions) ?? points.length, points }];
  });
  const planDays: PlanDayCount[] = asArray(root.plan_days).flatMap((item) => {
    const p = asObject(item);
    if (p === null) return [];
    return [{ title: typeof p.title === "string" ? p.title : null, workouts: num(p.workouts) ?? 0 }];
  });
  return {
    range,
    bucket,
    from: str(root.from),
    to: str(root.to),
    days,
    exercises: mergeExercises(exercises),
    planDays,
    freeWorkouts: num(root.free_workouts) ?? 0,
    currentStreak: num(root.current_streak) ?? 0,
    longestStreak: num(root.longest_streak) ?? 0,
  };
}

/**
 * Aggregated training numbers of a person (own or someone else's). null: not visible to me
 * (the database checks the setting, the profile, blocks and the account status).
 */
export async function fetchTrainingStats(userId: string, range: StatsRange): Promise<TrainingStats | null> {
  const myId = await requireUserId();
  const { data, error } =
    userId === myId
      ? await supabase.rpc("get_my_training_stats", { p_range: range })
      : await supabase.rpc("get_training_stats", { p_user_id: userId, p_range: range });
  if (error) throw error;
  return data === null ? null : parseStats(data);
}

/** Whether I may see someone's statistics (for the button on their profile). */
export async function canViewTrainingStats(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_view_training_stats", { target: userId });
  if (error) throw error;
  return data === true;
}

export async function getTrainingStatsVisibility(): Promise<ActivityVisibility> {
  const userId = await requireUserId();
  const { data, error } = await supabase.from("profiles").select("training_stats_visibility").eq("id", userId).single();
  if (error) throw error;
  return data.training_stats_visibility;
}

export async function setTrainingStatsVisibility(value: ActivityVisibility): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("profiles").update({ training_stats_visibility: value }).eq("id", userId);
  if (error) throw error;
}
