import { StepError } from "@/lib/errors";
import { getSignedPhotoUrls, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { requireUserId } from "@/lib/session";
import { toDayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { WorkoutRepo } from "@/lib/workoutRepo";

export const supabaseWorkoutRepo: WorkoutRepo = {
  async listWorkoutDays() {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("posts")
      .select("workout_date")
      .eq("user_id", userId);
    if (error) throw error;
    return data.map((row) => row.workout_date);
  },

  async listWorkoutsOnDay(day) {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("posts")
      .select("id, photo_path, caption, workout_date, created_at")
      .eq("user_id", userId)
      .eq("workout_date", day)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const urls = await getSignedPhotoUrls(data.map((row) => row.photo_path));
    return data.map((row) => ({
      id: row.id,
      workoutDate: row.workout_date,
      caption: row.caption,
      createdAt: row.created_at,
      photoUrl: urls.get(row.photo_path) ?? null,
    }));
  },

  async addWorkout({ sourceUri, caption }) {
    const userId = await requireUserId();
    const photoPath = await uploadPhoto(userId, "posts", sourceUri);
    const trimmed = caption.trim();

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: userId,
        photo_path: photoPath,
        caption: trimmed.length > 0 ? trimmed : null,
        workout_date: toDayKey(new Date()),
      })
      .select("id, workout_date, caption, created_at")
      .single();

    if (error) {
      // Don't leave an orphaned file behind if the post row could not be created.
      await removePhotos([photoPath]).catch(() => undefined);
      throw new StepError("Post speichern", error.message);
    }

    return {
      id: data.id,
      workoutDate: data.workout_date,
      caption: data.caption,
      createdAt: data.created_at,
    };
  },

  async deleteWorkout(id) {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("posts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("photo_path");
    if (error) throw error;
    // The row is gone either way; a leftover file is only wasted storage.
    await removePhotos(data.map((row) => row.photo_path)).catch((removeError: unknown) =>
      console.warn("[workouts] Foto konnte nicht gelöscht werden:", removeError),
    );
  },
};
