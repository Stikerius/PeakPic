export type Workout = {
  id: string;
  /** Displayable image URI (local file now, signed URL once backed by Supabase). */
  photoUri: string;
  caption: string | null;
  /** ISO 8601 timestamp of when the photo was saved. */
  createdAt: string;
};

export type NewWorkout = {
  /** Temporary URI from the camera or image picker. */
  sourceUri: string;
  caption: string;
};
