import { localWorkoutRepo } from "@/lib/workoutRepo.local";
import type { NewWorkout, Workout } from "@/types/workout";

/**
 * Single access point for workout data. Screens only talk to this interface,
 * so the backing store (local now, Supabase later) can be swapped here.
 */
export interface WorkoutRepo {
  /** All workouts of the current user, newest first. */
  listWorkouts(): Promise<Workout[]>;
  addWorkout(input: NewWorkout): Promise<Workout>;
}

export const workoutRepo: WorkoutRepo = localWorkoutRepo;
