import { toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { PostComment, PublicProfile } from "@/types/social";

export const COMMENT_MAX_LENGTH = 500;

const COMMENT_SELECT =
  "id, post_id, parent_comment_id, body, created_at, author:profiles!comments_user_id_fkey(id, username, display_name, avatar_path)";

type CommentRow = {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  author: { id: string; username: string; display_name: string; avatar_path: string | null };
};

function toComment(
  row: CommentRow,
  authors: Map<string, PublicProfile>,
  likes: { count: number; mine: boolean } = { count: 0, mine: false },
): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_comment_id,
    author: authors.get(row.author.id) ?? { id: row.author.id, username: row.author.username, displayName: row.author.display_name, avatarUrl: null },
    body: row.body,
    createdAt: row.created_at,
    likeCount: likes.count,
    likedByMe: likes.mine,
  };
}

/** Comments and replies of a post, oldest first, with like counts. */
export async function listComments(postId: string): Promise<PostComment[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (data.length === 0) return [];

  const [authors, likesResult] = await Promise.all([
    toPublicProfiles(data.map((row) => row.author)),
    supabase
      .from("comment_likes")
      .select("comment_id, user_id")
      .in(
        "comment_id",
        data.map((row) => row.id),
      ),
  ]);
  if (likesResult.error) throw likesResult.error;
  const likes = new Map<string, { count: number; mine: boolean }>();
  for (const like of likesResult.data) {
    const entry = likes.get(like.comment_id) ?? { count: 0, mine: false };
    likes.set(like.comment_id, { count: entry.count + 1, mine: entry.mine || like.user_id === userId });
  }
  return data.map((row) => toComment(row, authors, likes.get(row.id)));
}

/** `parentId` must be a top-level comment of the same post (replies are one level deep). */
export async function addComment(postId: string, body: string, parentId: string | null = null): Promise<PostComment> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, user_id: userId, body: body.trim(), parent_comment_id: parentId })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  return toComment(data, await toPublicProfiles([data.author]));
}

export async function setCommentLiked(commentId: string, liked: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = liked
    ? await supabase
        .from("comment_likes")
        .upsert({ comment_id: commentId, user_id: userId }, { ignoreDuplicates: true })
    : await supabase.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", userId);
  if (error) throw error;
}
