import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { toDayKey, type DayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import { isWorkoutLinkExpired } from "@/lib/workoutLinks";
import type { NotificationType, WorkoutShareStatus } from "@/types/database";
import type { PublicProfile } from "@/types/social";

const INBOX_LIMIT = 50;

/** A notification stored in the database (tags, workout links, follow requests). */
export type InboxItem = {
  id: string;
  type: NotificationType;
  actor: PublicProfile;
  createdAt: string;
  read: boolean;
  postId: string | null;
  storyId: string | null;
  commentId: string | null;
  /** Post cover or story photo, if I may see it. */
  photoUrl: string | null;
  commentBody: string | null;
  /** plan_adopted: the title of my plan that was adopted. */
  planTitle: string | null;
  link: {
    id: string;
    status: WorkoutShareStatus;
    expired: boolean;
    /** The original post is in the feed, so it can be reposted after accepting. */
    canRepost: boolean;
    reposted: boolean;
  } | null;
};

function planTitleOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("plan_title" in payload)) return null;
  return typeof payload.plan_title === "string" ? payload.plan_title : null;
}

/**
 * My stored notifications, newest first, with previews. Expired ones are invisible (RLS) and are
 * deleted first (purge_my_expired_notifications); the actions behind them (follow requests,
 * workout links, legal texts) stay reachable elsewhere.
 */
export async function fetchInbox(): Promise<InboxItem[]> {
  const userId = await requireUserId();
  await supabase.rpc("purge_my_expired_notifications").then(
    () => undefined,
    () => undefined,
  );
  const { data, error } = await supabase
    .from("notifications")
    .select(
      `id, type, created_at, read_at, post_id, story_id, comment_id, workout_share_id, payload, actor:profiles!notifications_actor_id_fkey!inner(${PROFILE_COLUMNS})`,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(INBOX_LIMIT);
  if (error) throw error;
  if (data.length === 0) return [];

  const ids = <K extends "post_id" | "story_id" | "comment_id" | "workout_share_id">(key: K) => [
    ...new Set(data.flatMap((row) => (row[key] !== null ? [row[key]] : []))),
  ];
  const postIds = ids("post_id");
  const [actors, posts, stories, comments, shares, reposts] = await Promise.all([
    toPublicProfiles(data.map((row) => row.actor)),
    postIds.length > 0
      ? supabase.from("posts").select("id, photo_path, workout_date, in_feed").in("id", postIds)
      : Promise.resolve({ data: [], error: null }),
    ids("story_id").length > 0
      ? supabase.from("stories").select("id, photo_path").in("id", ids("story_id"))
      : Promise.resolve({ data: [], error: null }),
    ids("comment_id").length > 0
      ? supabase.from("comments").select("id, body").in("id", ids("comment_id"))
      : Promise.resolve({ data: [], error: null }),
    ids("workout_share_id").length > 0
      ? supabase.from("workout_shares").select("id, status, post_id").in("id", ids("workout_share_id"))
      : Promise.resolve({ data: [], error: null }),
    postIds.length > 0
      ? supabase.from("post_reposts").select("original_post_id").eq("reposter_id", userId).in("original_post_id", postIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [posts, stories, comments, shares, reposts]) {
    if (result.error) throw result.error;
  }

  const postById = new Map((posts.data ?? []).map((p) => [p.id, p]));
  const storyById = new Map((stories.data ?? []).map((s) => [s.id, s]));
  const commentById = new Map((comments.data ?? []).map((c) => [c.id, c]));
  const shareById = new Map((shares.data ?? []).map((s) => [s.id, s]));
  const reposted = new Set((reposts.data ?? []).map((r) => r.original_post_id));
  const urls = await getSignedPhotoUrls([
    ...(posts.data ?? []).map((p) => p.photo_path),
    ...(stories.data ?? []).map((s) => s.photo_path),
  ]);
  const today: DayKey = toDayKey(new Date());

  return data.map((row) => {
    const post = row.post_id !== null ? postById.get(row.post_id) : undefined;
    const story = row.story_id !== null ? storyById.get(row.story_id) : undefined;
    const share = row.workout_share_id !== null ? shareById.get(row.workout_share_id) : undefined;
    const photoPath = post?.photo_path ?? story?.photo_path;
    return {
      id: row.id,
      type: row.type,
      actor: actors.get(row.actor.id) ?? { id: row.actor.id, username: row.actor.username, displayName: row.actor.display_name, avatarUrl: null },
      createdAt: row.created_at,
      read: row.read_at !== null,
      postId: row.post_id,
      storyId: row.story_id,
      commentId: row.comment_id,
      photoUrl: photoPath !== undefined ? (urls.get(photoPath) ?? null) : null,
      commentBody: row.comment_id !== null ? (commentById.get(row.comment_id)?.body ?? null) : null,
      planTitle: planTitleOf(row.payload),
      link:
        share !== undefined
          ? {
              id: share.id,
              status: share.status,
              expired: post !== undefined && isWorkoutLinkExpired(post.workout_date, today),
              canRepost: post?.in_feed === true,
              reposted: reposted.has(share.post_id),
            }
          : null,
    };
  });
}

export async function countUnreadInbox(): Promise<number> {
  const userId = await requireUserId();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Marks the given notifications as seen (only what the list really showed: from then on they
 * expire 7 days later). Already seen ones keep their time.
 */
export async function markInboxRead(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const userId = await requireUserId();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("id", [...ids])
    .is("read_at", null);
  if (error) throw error;
}

/** Live: new or changed notifications for me (RLS limits Realtime to my rows). */
export function subscribeToInbox(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`inbox:${userId}:${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Of `userIds`, the people I may tag in my posts or stories (same rule as the database). */
export async function filterTaggable(userIds: string[], scope: "posts" | "stories"): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data, error } = await supabase.rpc("taggable_user_ids", { ids: userIds, scope });
  if (error) throw error;
  return new Set(data);
}
