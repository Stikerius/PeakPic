import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { normalizeHashtag } from "@/lib/taggedText";
import { supabase } from "@/lib/supabase";
import type { PostThumbnail } from "@/lib/userProfileRepo";

const HASHTAG_POSTS_LIMIT = 60;

export type HashtagPage = { tag: string; useCount: number; posts: PostThumbnail[] };

/**
 * A hashtag with the posts that use it, newest first – only posts I may see (RLS on
 * content_hashtags and posts), and only ones published to the feed.
 */
export async function fetchHashtagPage(rawTag: string): Promise<HashtagPage> {
  const tag = normalizeHashtag(rawTag) ?? "";
  const { data: hashtag, error } = await supabase.from("hashtags").select("id, tag, use_count").eq("tag", tag).maybeSingle();
  if (error) throw error;
  if (hashtag === null) return { tag, useCount: 0, posts: [] };

  const { data: links, error: linksError } = await supabase
    .from("content_hashtags")
    .select("source_id")
    .eq("hashtag_id", hashtag.id)
    .eq("source", "post")
    .order("created_at", { ascending: false })
    .limit(HASHTAG_POSTS_LIMIT);
  if (linksError) throw linksError;
  const ids = links.map((l) => l.source_id);
  if (ids.length === 0) return { tag: hashtag.tag, useCount: hashtag.use_count, posts: [] };

  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select("id, photo_path, created_at")
    .in("id", ids)
    .eq("in_feed", true)
    .order("created_at", { ascending: false });
  if (postsError) throw postsError;
  const [urls, media] = await Promise.all([
    getSignedPhotoUrls(posts.map((p) => p.photo_path)),
    supabase.from("post_media").select("post_id").in("post_id", posts.map((p) => p.id)),
  ]);
  if (media.error) throw media.error;
  const counts = new Map<string, number>();
  for (const row of media.data) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  return {
    tag: hashtag.tag,
    useCount: hashtag.use_count,
    posts: posts.map((p) => ({
      id: p.id,
      key: p.id,
      photoUrl: urls.get(p.photo_path) ?? null,
      photoCount: counts.get(p.id) ?? 1,
      isRepost: false,
      planTitle: null,
    })),
  };
}
