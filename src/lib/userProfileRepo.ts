import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { formatPlanLabel } from "@/lib/planRepo";
import { fetchPostPhotoUrls } from "@/lib/postRepo";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { fetchFollowCounts, type FollowStatus } from "@/lib/socialRepo";
import { fetchWorkoutDays, type WorkoutDays } from "@/lib/workoutDaysRepo";
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

export type PostThumbnail = {
  /** Post id (for reposts: the original post's id). */
  id: string;
  /** Unique per tile. */
  key: string;
  photoUrl: string | null;
  photoCount: number;
  /** A repost of someone else's post (shown with a repost icon). */
  isRepost: boolean;
  /** Plan unit of the post (quiet label on the tile). */
  planTitle: string | null;
};

/** Rows per page in the profile tabs. */
export const PROFILE_PAGE_SIZE = 30;

/** A page of a profile tab; nextCursor null means there is nothing more. */
export type ProfilePage<T> = { items: T[]; nextCursor: string | null };

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

/** Training days of another user (own posts and accepted workout links), as far as I may see them. */
export async function fetchUserWorkoutDays(userId: string): Promise<WorkoutDays> {
  return fetchWorkoutDays(userId);
}

/**
 * One page of posts and reposts for the profile grid, newest first, older than `cursor`
 * (created_at): only posts in the feed with "Im Profil anzeigen" (streak-only proofs stay out).
 * RLS decides what other people may see; a repost only shows up where its original is readable.
 */
export async function fetchProfileGridPage(userId: string, cursor: string | null): Promise<ProfilePage<PostThumbnail>> {
  let ownQuery = supabase
    .from("posts")
    .select("id, photo_path, created_at, plan_day_title")
    .eq("user_id", userId)
    .eq("in_feed", true)
    .eq("show_in_profile", true)
    .order("created_at", { ascending: false })
    .limit(PROFILE_PAGE_SIZE);
  let repostQuery = supabase
    .from("post_reposts")
    .select("id, original_post_id, created_at")
    .eq("reposter_id", userId)
    .order("created_at", { ascending: false })
    .limit(PROFILE_PAGE_SIZE);
  if (cursor !== null) {
    ownQuery = ownQuery.lt("created_at", cursor);
    repostQuery = repostQuery.lt("created_at", cursor);
  }
  const [own, reposts] = await Promise.all([ownQuery, repostQuery]);
  if (own.error) throw own.error;
  if (reposts.error) throw reposts.error;

  const originalIds = [...new Set(reposts.data.map((r) => r.original_post_id))];
  const originals =
    originalIds.length > 0 ? await supabase.from("posts").select("id, photo_path").in("id", originalIds) : null;
  if (originals?.error) throw originals.error;
  const originalById = new Map((originals?.data ?? []).map((p) => [p.id, p]));

  // Both sources are cut at the page size, so only the newest page size of the merge is complete.
  // The cursor comes from that merge, before reposts with an unreadable original are dropped.
  const merged = [
    ...own.data.map((p) => ({ at: p.created_at, post: p, repost: null })),
    ...reposts.data.map((r) => ({ at: r.created_at, post: null, repost: r })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, PROFILE_PAGE_SIZE);
  const full = own.data.length === PROFILE_PAGE_SIZE || reposts.data.length === PROFILE_PAGE_SIZE;
  const nextCursor = full ? (merged[merged.length - 1]?.at ?? null) : null;

  type Tile = { key: string; id: string; photoPath: string; isRepost: boolean; planTitle: string | null };
  const tiles: Tile[] = merged.flatMap((entry): Tile[] => {
    if (entry.post !== null) {
      const p = entry.post;
      return [{ key: p.id, id: p.id, photoPath: p.photo_path, isRepost: false, planTitle: p.plan_day_title }];
    }
    const r = entry.repost;
    const original = r !== null ? originalById.get(r.original_post_id) : undefined;
    return r !== null && original !== undefined
      ? [{ key: `repost:${r.id}`, id: original.id, photoPath: original.photo_path, isRepost: true, planTitle: null }]
      : [];
  });
  if (tiles.length === 0) return { items: [], nextCursor };

  const [urls, media] = await Promise.all([
    getSignedPhotoUrls(tiles.map((t) => t.photoPath)),
    supabase
      .from("post_media")
      .select("post_id")
      .in(
        "post_id",
        tiles.map((t) => t.id),
      ),
  ]);
  if (media.error) throw media.error;
  const counts = new Map<string, number>();
  for (const row of media.data) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  return {
    items: tiles.map((t) => ({
      id: t.id,
      key: t.key,
      photoUrl: urls.get(t.photoPath) ?? null,
      photoCount: counts.get(t.id) ?? 1,
      isRepost: t.isRepost,
      planTitle: t.planTitle,
    })),
    nextCursor,
  };
}

/** Another user's workouts on one day (read-only), oldest first; streak-only proofs stay private. */
export async function fetchUserPostsOnDay(userId: string, day: DayKey): Promise<WorkoutWithPhoto[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path, caption, workout_date, created_at, in_feed, plan_day_title, plan_day_position, plan_length")
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
    planLabel: formatPlanLabel(row.plan_day_title, row.plan_day_position, row.plan_length),
  }));
}

/** Profiles by id (e.g. for notifications), with signed avatar URLs. */
export async function fetchProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
  if (error) throw error;
  return toPublicProfiles(data);
}
