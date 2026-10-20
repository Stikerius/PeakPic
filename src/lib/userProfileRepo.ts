import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { fetchPostPhotoUrls } from "@/lib/postRepo";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { fetchFollowCounts, type FollowStatus } from "@/lib/socialRepo";
import type { DayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";
import type { WorkoutWithPhoto } from "@/types/workout";

export type UserProfileSummary = {
  profile: PublicProfile;
  followerCount: number;
  followingCount: number;
  /** My follow status towards them. */
  followStatus: FollowStatus;
  /** They follow me (accepted). */
  followsMe: boolean;
  isPrivate: boolean;
  /** What I may see (the database enforces the same rules). */
  canSeePosts: boolean;
  canSeeStories: boolean;
  canSeeLists: boolean;
};

export type PostThumbnail = { id: string; photoUrl: string | null; photoCount: number };

const GRID_POSTS_LIMIT = 60;

export async function fetchUserProfile(userId: string): Promise<UserProfileSummary | null> {
  const myId = await requireUserId();
  const [profileResult, counts, iFollow, theyFollow] = await Promise.all([
    supabase
      .from("profiles")
      .select(`${PROFILE_COLUMNS}, is_private, story_visibility, post_visibility`)
      .eq("id", userId)
      .maybeSingle(),
    fetchFollowCounts(userId),
    supabase.from("follows").select("status").eq("follower_id", myId).eq("following_id", userId).maybeSingle(),
    supabase
      .from("follows")
      .select("status")
      .eq("follower_id", userId)
      .eq("following_id", myId)
      .eq("status", "accepted")
      .maybeSingle(),
  ]);
  for (const result of [profileResult, iFollow, theyFollow]) {
    if (result.error) throw result.error;
  }
  const row = profileResult.data;
  if (row === null) return null;
  const profile = (await toPublicProfiles([row])).get(userId);
  if (profile === undefined) return null;
  const followStatus: FollowStatus = iFollow.data?.status ?? "none";
  const following = followStatus === "accepted" || userId === myId;
  return {
    profile,
    followerCount: counts.followers,
    followingCount: counts.following,
    followStatus,
    followsMe: theyFollow.data !== null,
    isPrivate: row.is_private,
    canSeePosts: following || (!row.is_private && row.post_visibility === "everyone"),
    canSeeStories: following || (!row.is_private && row.story_visibility === "everyone"),
    canSeeLists: following || !row.is_private,
  };
}

/** Training days of another user, as far as their privacy settings let me see. */
export async function fetchUserWorkoutDays(userId: string): Promise<DayKey[]> {
  const { data, error } = await supabase.from("posts").select("workout_date").eq("user_id", userId);
  if (error) throw error;
  return data.map((row) => row.workout_date);
}

/**
 * Posts for the profile grid, newest first: only posts in the feed with "Im Profil anzeigen"
 * (streak-only proofs stay out). RLS decides what other people may see at all.
 */
export async function fetchProfileGrid(userId: string): Promise<PostThumbnail[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path")
    .eq("user_id", userId)
    .eq("in_feed", true)
    .eq("show_in_profile", true)
    .order("created_at", { ascending: false })
    .limit(GRID_POSTS_LIMIT);
  if (error) throw error;
  if (data.length === 0) return [];
  const [urls, media] = await Promise.all([
    getSignedPhotoUrls(data.map((row) => row.photo_path)),
    supabase
      .from("post_media")
      .select("post_id")
      .in(
        "post_id",
        data.map((row) => row.id),
      ),
  ]);
  if (media.error) throw media.error;
  const counts = new Map<string, number>();
  for (const row of media.data) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  return data.map((row) => ({
    id: row.id,
    photoUrl: urls.get(row.photo_path) ?? null,
    photoCount: counts.get(row.id) ?? 1,
  }));
}

/** Another user's workouts on one day (read-only), oldest first; streak-only proofs stay private. */
export async function fetchUserPostsOnDay(userId: string, day: DayKey): Promise<WorkoutWithPhoto[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path, caption, workout_date, created_at, in_feed")
    .eq("user_id", userId)
    .eq("workout_date", day)
    .eq("in_feed", true)
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
}

/** Profiles by id (e.g. for notifications), with signed avatar URLs. */
export async function fetchProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
  if (error) throw error;
  return toPublicProfiles(data);
}
