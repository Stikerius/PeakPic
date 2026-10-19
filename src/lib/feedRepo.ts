import { getSignedPhotoUrls } from "@/lib/photoUpload";
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

/**
 * Posts by people I follow plus my own, newest first.
 * RLS would also return posts shared with me in chats, so authors are filtered explicitly.
 */
export async function fetchFeedPage(cursor: string | null): Promise<FeedPage> {
  const userId = await requireUserId();
  const authorIds = [userId, ...(await getFollowingIds())];

  let query = supabase
    .from("posts")
    .select(
      "id, photo_path, caption, workout_date, created_at, author:profiles!posts_user_id_fkey(id, username, avatar_path)",
    )
    .in("user_id", authorIds)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  if (cursor !== null) query = query.lt("created_at", cursor);

  const { data: rows, error } = await query;
  if (error) throw error;
  if (rows.length === 0) return { posts: [], nextCursor: null };

  const postIds = rows.map((r) => r.id);
  const [likesResult, commentsResult, photoUrls, authors] = await Promise.all([
    supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
    supabase.from("comments").select("post_id").in("post_id", postIds),
    getSignedPhotoUrls(rows.map((r) => r.photo_path)),
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

  const posts: FeedPost[] = rows.map((r) => ({
    id: r.id,
    author: authors.get(r.author.id) ?? { id: r.author.id, username: r.author.username, avatarUrl: null },
    photoUrl: photoUrls.get(r.photo_path) ?? null,
    caption: r.caption,
    workoutDate: r.workout_date,
    createdAt: r.created_at,
    likeCount: likeCounts.get(r.id) ?? 0,
    likedByMe: likedByMe.has(r.id),
    commentCount: commentCounts.get(r.id) ?? 0,
  }));

  return {
    posts,
    nextCursor: rows.length === FEED_PAGE_SIZE ? (rows[rows.length - 1]?.created_at ?? null) : null,
  };
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
