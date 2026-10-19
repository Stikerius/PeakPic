import type { DayKey } from "@/lib/streak";
import { supabaseWorkoutRepo } from "@/lib/workoutRepo.supabase";
import type { NewWorkout, Workout, WorkoutWithPhoto } from "@/types/workout";

/**
 * Single access point for workout data. Screens only talk to this interface,
 * so the backing store can be swapped here (local: workoutRepo.local.ts).
 */
export interface WorkoutRepo {
  /** Training days of the current user (duplicates allowed). */
  listWorkoutDays(): Promise<DayKey[]>;
  /** Workouts of the current user on one training day, oldest first. */
  listWorkoutsOnDay(day: DayKey): Promise<WorkoutWithPhoto[]>;
  addWorkout(input: NewWorkout): Promise<Workout>;
  /** Removes the workout and its photo. */
  deleteWorkout(id: string): Promise<void>;
}

export const workoutRepo: WorkoutRepo = supabaseWorkoutRepo;
