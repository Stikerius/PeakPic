import { emitAppEvent } from "@/lib/events";
import { groupNotifications, type ActivityEvent, type NotificationGroup } from "@/lib/notifications";
import { requireUserId } from "@/lib/session";
import { getFollowingIds } from "@/lib/socialRepo";
import { supabase } from "@/lib/supabase";
import { fetchProfiles } from "@/lib/userProfileRepo";
import type { PublicProfile } from "@/types/social";

/** How far back the notifications screen looks. */
const WINDOW_DAYS = 7;

export type NotificationFeed = {
  groups: NotificationGroup[];
  profiles: Map<string, PublicProfile>;
  /** Groups newer than this are unread. */
  seenAt: string;
};

/**
 * Collects recent activity relevant to me. Visibility (hidden stories/posts etc.)
 * is enforced by RLS, so nothing shows up here that I couldn't open.
 */
export async function fetchNotifications(): Promise<NotificationFeed> {
  const me = await requireUserId();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const following = await getFollowingIds();

  // Tags (stories, posts, comments) come from the notifications table now (inboxRepo).
  const [seen, stories, workouts, likes, comments, follows, storyLikes] = await Promise.all([
    supabase.from("profiles").select("notifications_seen_at").eq("id", me).single(),
    supabase.from("stories").select("user_id, created_at").in("user_id", following).gt("expires_at", now),
    supabase
      .from("posts")
      .select("id, user_id, workout_date, created_at")
      .in("user_id", following)
      .gt("created_at", since),
    supabase
      .from("post_likes")
      .select("post_id, user_id, created_at, post:posts!inner(user_id)")
      .eq("post.user_id", me)
      .neq("user_id", me)
      .gt("created_at", since),
    supabase
      .from("comments")
      .select("id, post_id, user_id, body, created_at, post:posts!inner(user_id)")
      .eq("post.user_id", me)
      .neq("user_id", me)
      .gt("created_at", since),
    supabase
      .from("follows")
      .select("follower_id, created_at")
      .eq("following_id", me)
      .eq("status", "accepted")
      .gt("created_at", since),
    supabase
      .from("story_likes")
      .select("story_id, user_id, created_at, story:stories!inner(user_id)")
      .eq("story.user_id", me)
      .neq("user_id", me)
      .gt("created_at", since),
  ]);
  for (const result of [seen, stories, workouts, likes, comments, follows, storyLikes]) {
    if (result.error) throw result.error;
  }

  const events: ActivityEvent[] = [
    ...(stories.data ?? []).map((s): ActivityEvent => ({ kind: "story", actorId: s.user_id, at: s.created_at })),
    ...(workouts.data ?? []).map(
      (p): ActivityEvent => ({ kind: "workout", actorId: p.user_id, at: p.created_at, day: p.workout_date, postId: p.id }),
    ),
    ...(likes.data ?? []).map(
      (l): ActivityEvent => ({ kind: "post_like", actorId: l.user_id, at: l.created_at, postId: l.post_id }),
    ),
    ...(comments.data ?? []).map(
      (c): ActivityEvent => ({
        kind: "comment",
        actorId: c.user_id,
        at: c.created_at,
        postId: c.post_id,
        text: c.body,
        commentId: c.id,
      }),
    ),
    ...(follows.data ?? []).map((f): ActivityEvent => ({ kind: "follow", actorId: f.follower_id, at: f.created_at })),
    ...(storyLikes.data ?? []).map(
      (l): ActivityEvent => ({ kind: "story_like", actorId: l.user_id, at: l.created_at, storyId: l.story_id }),
    ),

  ];

  const groups = groupNotifications(events);
  const profiles = await fetchProfiles([...new Set(events.map((e) => e.actorId))]);
  return { groups, profiles, seenAt: seen.data?.notifications_seen_at ?? now };
}

export async function countUnreadNotifications(): Promise<number> {
  const { groups, seenAt } = await fetchNotifications();
  return groups.filter((g) => g.latestAt > seenAt).length;
}

export async function markNotificationsSeen(): Promise<void> {
  const me = await requireUserId();
  const { error } = await supabase
    .from("profiles")
    .update({ notifications_seen_at: new Date().toISOString() })
    .eq("id", me);
  if (error) throw error;
  emitAppEvent("notificationsSeen", undefined);
}
