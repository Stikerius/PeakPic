import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { fetchPostPhotoUrls } from "@/lib/postRepo";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import type { DayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";
import type { WorkoutWithPhoto } from "@/types/workout";

export type UserProfileSummary = {
  profile: PublicProfile;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  followsMe: boolean;
};

export type PostThumbnail = { id: string; photoUrl: string | null };

const RECENT_POSTS_LIMIT = 30;

export async function fetchUserProfile(userId: string): Promise<UserProfileSummary | null> {
  const myId = await requireUserId();
  const [profileResult, followers, following, iFollow, theyFollow] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId),
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("follower_id", myId)
      .eq("following_id", userId),
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("follower_id", userId)
      .eq("following_id", myId),
  ]);
  for (const result of [profileResult, followers, following, iFollow, theyFollow]) {
    if (result.error) throw result.error;
  }
  if (profileResult.data === null) return null;
  const profile = (await toPublicProfiles([profileResult.data])).get(userId);
  if (profile === undefined) return null;
  return {
    profile,
    followerCount: followers.count ?? 0,
    followingCount: following.count ?? 0,
    isFollowing: (iFollow.count ?? 0) > 0,
    followsMe: (theyFollow.count ?? 0) > 0,
  };
}

/** Training days of another user, as far as their privacy settings let me see. */
export async function fetchUserWorkoutDays(userId: string): Promise<DayKey[]> {
  const { data, error } = await supabase.from("posts").select("workout_date").eq("user_id", userId);
  if (error) throw error;
  return data.map((row) => row.workout_date);
}

export async function fetchUserRecentPosts(userId: string): Promise<PostThumbnail[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_POSTS_LIMIT);
  if (error) throw error;
  const urls = await getSignedPhotoUrls(data.map((row) => row.photo_path));
  return data.map((row) => ({ id: row.id, photoUrl: urls.get(row.photo_path) ?? null }));
}

/** Another user's workouts on one day (read-only), oldest first. */
export async function fetchUserPostsOnDay(userId: string, day: DayKey): Promise<WorkoutWithPhoto[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path, caption, workout_date, created_at")
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
  }));
}

/** Profiles by id (e.g. for notifications), with signed avatar URLs. */
export async function fetchProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
  if (error) throw error;
  return toPublicProfiles(data);
}
