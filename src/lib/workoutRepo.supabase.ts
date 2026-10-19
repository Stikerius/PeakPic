import { removePhotos, uploadPhoto } from "@/lib/photoUpload";
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
      throw error;
    }

    return {
      id: data.id,
      workoutDate: data.workout_date,
      caption: data.caption,
      createdAt: data.created_at,
    };
  },
};
