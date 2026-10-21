import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { WorkoutShareStatus } from "@/types/database";
import type { PublicProfile } from "@/types/social";

export type WorkoutLink = { id: string; person: PublicProfile; status: WorkoutShareStatus };

/**
 * Asks tagged people to count this workout for their streak. The database only accepts
 * people tagged in the post, creates the rows as "pending" and notifies them.
 */
export async function requestWorkoutLinks(postId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const { error } = await supabase
    .from("workout_shares")
    .upsert(
      unique.map((userId) => ({ post_id: postId, tagged_user_id: userId })),
      { onConflict: "post_id,tagged_user_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

/** Accept or decline a link to me (only possible for me, once, until the deadline). */
export async function answerWorkoutLink(shareId: string, accept: boolean): Promise<void> {
  const { error } = await supabase
    .from("workout_shares")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", shareId)
    .eq("status", "pending");
  if (error) throw error;
}

/** The post owner withdraws a request that hasn't been answered yet. */
export async function withdrawWorkoutLink(shareId: string): Promise<void> {
  const { error } = await supabase.from("workout_shares").delete().eq("id", shareId).eq("status", "pending");
  if (error) throw error;
}

/** Links of one of my posts with their status. */
export async function listWorkoutLinks(postId: string): Promise<WorkoutLink[]> {
  const { data, error } = await supabase
    .from("workout_shares")
    .select(`id, status, person:profiles!workout_shares_tagged_user_id_fkey!inner(${PROFILE_COLUMNS})`)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const profiles = await toPublicProfiles(data.map((row) => row.person));
  return data.flatMap((row) => {
    const person = profiles.get(row.person.id);
    return person !== undefined ? [{ id: row.id, person, status: row.status }] : [];
  });
}

/** My own link to someone else's post, if there is one. */
export async function getMyWorkoutLink(postId: string): Promise<{ id: string; status: WorkoutShareStatus } | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("workout_shares")
    .select("id, status")
    .eq("post_id", postId)
    .eq("tagged_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
