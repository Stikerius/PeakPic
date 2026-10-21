import { formatPlanLabel } from "@/lib/planRepo";
import { fetchPostPhotos, fetchPostTags } from "@/lib/postRepo";
import { fetchRepostsBy } from "@/lib/repostRepo";
import { toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { getFollowingIds } from "@/lib/socialRepo";
import { supabase } from "@/lib/supabase";
import type { FeedPost } from "@/types/social";

export const FEED_PAGE_SIZE = 10;

export type FeedPage = {
  posts: FeedPost[];
  /** created_at of the last post; pass it to load the next page. Null when there is no more. */
  nextCursor: string | null;
};

const POST_SELECT =
  "id, photo_path, caption, workout_date, created_at, is_day_post, show_in_profile, plan_day_title, plan_day_position, plan_length, author:profiles!posts_user_id_fkey(id, username, display_name, avatar_path)";

type PostRow = {
  id: string;
  photo_path: string;
  caption: string | null;
  workout_date: string;
  created_at: string;
  is_day_post: boolean;
  show_in_profile: boolean;
  plan_day_title: string | null;
  plan_day_position: number | null;
  plan_length: number | null;
  author: { id: string; username: string; display_name: string; avatar_path: string | null };
};

/** Adds author avatar, signed photo URLs, tags, like and comment counts to post rows. */
async function hydratePosts(rows: PostRow[], userId: string): Promise<FeedPost[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.id);
  const [likesResult, commentsResult, photoUrls, tags, authors] = await Promise.all([
    supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
    supabase.from("comments").select("post_id").in("post_id", postIds),
    fetchPostPhotos(rows),
    fetchPostTags(postIds),
    toPublicProfiles(rows.map((r) => r.author)),
  ]);
  if (likesResult.error) throw likesResult.error;
  if (commentsResult.error) throw commentsResult.error;

  const likeCounts = new Map<string, number>();
  const likedByMe = new Set<string>();
  for (const like of likesResult.data) {
    likeCounts.set(like.post_id, (likeCounts.get(like.post_id) ?? 0) + 1);
    if (like.user_id === userId) likedByMe.add(like.post_id);
  }
  const commentCounts = new Map<string, number>();
  for (const comment of commentsResult.data) {
    commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    feedKey: r.id,
    repost: null,
    id: r.id,
    author: authors.get(r.author.id) ?? { id: r.author.id, username: r.author.username, displayName: r.author.display_name, avatarUrl: null },
    photoUrl: photoUrls.get(r.id)?.[0]?.url ?? null,
    photoUrls: (photoUrls.get(r.id) ?? []).map((p) => p.url),
    photoMentions: (photoUrls.get(r.id) ?? []).map((p) => p.mentions),
    tags: tags.get(r.id) ?? [],
    isDayPost: r.is_day_post,
    showInProfile: r.show_in_profile,
    caption: r.caption,
    workoutDate: r.workout_date,
    planLabel: formatPlanLabel(r.plan_day_title, r.plan_day_position, r.plan_length),
    createdAt: r.created_at,
    likeCount: likeCounts.get(r.id) ?? 0,
    likedByMe: likedByMe.has(r.id),
    commentCount: commentCounts.get(r.id) ?? 0,
  }));
}

/**
 * Posts and reposts by people I follow plus my own, newest first; training proofs that
 * weren't published to the feed (in_feed = false) are left out.
 * RLS would also return posts shared with me in chats, so authors are filtered explicitly.
 * Reposts only come back where I may read the original too (RLS on post_reposts).
 */
export async function fetchFeedPage(cursor: string | null): Promise<FeedPage> {
  const userId = await requireUserId();
  const authorIds = [userId, ...(await getFollowingIds())];

  let query = supabase
    .from("posts")
    .select(POST_SELECT)
    .in("user_id", authorIds)
    .eq("in_feed", true)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  if (cursor !== null) query = query.lt("created_at", cursor);

  const [{ data: rows, error }, reposts] = await Promise.all([
    query,
    fetchRepostsBy(authorIds, cursor, FEED_PAGE_SIZE),
  ]);
  if (error) throw error;

  // Originals of the reposts (unreadable ones are dropped).
  const originalIds = [...new Set(reposts.map((r) => r.originalPostId))];
  const originals =
    originalIds.length > 0 ? await supabase.from("posts").select(POST_SELECT).in("id", originalIds) : null;
  if (originals?.error) throw originals.error;
  const hydrated = await hydratePosts([...rows, ...(originals?.data ?? [])], userId);
  const byId = new Map(hydrated.map((p) => [p.id, p]));

  type Entry = { at: string; post: FeedPost };
  const entries: Entry[] = [
    ...rows.flatMap((r): Entry[] => {
      const post = byId.get(r.id);
      return post !== undefined ? [{ at: r.created_at, post }] : [];
    }),
    ...reposts.flatMap((r): Entry[] => {
      const original = byId.get(r.originalPostId);
      return original !== undefined
        ? [{ at: r.createdAt, post: { ...original, feedKey: `repost:${r.id}`, repost: { ...r } } }]
        : [];
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Both lists are cut at the page size, so only the first page-size entries are complete.
  const page = entries.slice(0, FEED_PAGE_SIZE);
  const more = rows.length === FEED_PAGE_SIZE || reposts.length === FEED_PAGE_SIZE || entries.length > FEED_PAGE_SIZE;
  return {
    posts: page.map((e) => e.post),
    nextCursor: more ? (page[page.length - 1]?.at ?? null) : null,
  };
}

/** A single post (e.g. opened from a chat). Null if it was deleted or isn't visible to me. */
export async function fetchPost(postId: string): Promise<FeedPost | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase.from("posts").select(POST_SELECT).eq("id", postId).maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return (await hydratePosts([data], userId))[0] ?? null;
}

export async function setPostLiked(postId: string, liked: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = liked
    ? await supabase
        .from("post_likes")
        .upsert({ post_id: postId, user_id: userId }, { ignoreDuplicates: true })
    : await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw error;
}
