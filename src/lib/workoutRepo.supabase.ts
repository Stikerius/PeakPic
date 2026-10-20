import { StepError } from "@/lib/errors";
import { removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { fetchPostPhotoUrls } from "@/lib/postRepo";
import { fetchWorkoutDays } from "@/lib/workoutDaysRepo";
import { requireUserId } from "@/lib/session";
import { toDayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { WorkoutRepo } from "@/lib/workoutRepo";

export const supabaseWorkoutRepo: WorkoutRepo = {
  // Own counting posts plus accepted workout links, from the database (workout_days).
  async listWorkoutDays() {
    return (await fetchWorkoutDays()).days;
  },

  async listWorkoutsOnDay(day) {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("posts")
      .select("id, photo_path, caption, workout_date, created_at, in_feed")
      .eq("user_id", userId)
      .eq("workout_date", day)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const urls = await fetchPostPhotoUrls(data);
    return data.map((row) => ({
      id: row.id,
      workoutDate: row.workout_date,
      caption: row.caption,
      createdAt: row.created_at,
      photoUrl: urls.get(row.id)?.[0] ?? null,
      photoUrls: urls.get(row.id) ?? [],
      inFeed: row.in_feed,
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
    // Carousel photos: their rows go with the post (cascade), the files need removing too.
    const media = await supabase.from("post_media").select("photo_path, original_path").eq("post_id", id);
    const mediaPaths =
      media.data?.flatMap((row) => (row.original_path !== null ? [row.photo_path, row.original_path] : [row.photo_path])) ??
      [];
    const { data, error } = await supabase
      .from("posts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("photo_path");
    if (error) throw error;
    // The row is gone either way; a leftover file is only wasted storage.
    if (data.length === 0) return;
    const paths = [...new Set([...data.map((row) => row.photo_path), ...mediaPaths])];
    await removePhotos(paths).catch((removeError: unknown) =>
      console.warn("[workouts] Foto konnte nicht gelöscht werden:", removeError),
    );
  },
};
