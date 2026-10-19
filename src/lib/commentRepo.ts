import { toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { PostComment } from "@/types/social";

export const COMMENT_MAX_LENGTH = 500;

const COMMENT_SELECT =
  "id, post_id, body, created_at, author:profiles!comments_user_id_fkey(id, username, avatar_path)";

/** Comments of a post, oldest first. */
export async function listComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const authors = await toPublicProfiles(data.map((row) => row.author));
  return data.map((row) => ({
    id: row.id,
    postId: row.post_id,
    author: authors.get(row.author.id) ?? { id: row.author.id, username: row.author.username, avatarUrl: null },
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function addComment(postId: string, body: string): Promise<PostComment> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, user_id: userId, body: body.trim() })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  const authors = await toPublicProfiles([data.author]);
  return {
    id: data.id,
    postId: data.post_id,
    author: authors.get(data.author.id) ?? { id: data.author.id, username: data.author.username, avatarUrl: null },
    body: data.body,
    createdAt: data.created_at,
  };
}
