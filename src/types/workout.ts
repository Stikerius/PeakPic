import type { DayKey } from "@/lib/streak";

export type Workout = {
  id: string;
  /** Training day in Europe/Zurich, "YYYY-MM-DD". */
  workoutDate: DayKey;
  caption: string | null;
  /** ISO 8601 timestamp of when the photo was saved. */
  createdAt: string;
};

export type WorkoutWithPhoto = Workout & {
  /** Displayable URI (signed URL or local file); null if it could not be resolved. */
  photoUrl: string | null;
};

export type NewWorkout = {
  /** Temporary URI from the camera or image picker. */
  sourceUri: string;
  caption: string;
};
