import { StepError } from "@/lib/errors";
import { getSignedPhotoUrls, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { toDayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";

export type NewPost = {
  /** Local files (already edited), in carousel order. */
  photoUris: string[];
  caption: string;
  /** false: only a training proof for streak and calendar, not in the feed. */
  inFeed: boolean;
  /** The day's slideshow (first proof of the day) or an extra single post. */
  isDayPost: boolean;
  tagIds: string[];
};

/** Postgres unique_violation: a second day post for the same day. */
const UNIQUE_VIOLATION = "23505";

/** Uploads photos one after another; on failure removes the ones already uploaded. */
async function uploadAll(userId: string, uris: string[]): Promise<string[]> {
  const paths: string[] = [];
  try {
    for (const uri of uris) paths.push(await uploadPhoto(userId, "posts", uri));
    return paths;
  } catch (error) {
    await removePhotos(paths).catch(() => undefined);
    throw error;
  }
}

async function insertMedia(postId: string, userId: string, paths: string[], firstPosition: number) {
  const { error } = await supabase.from("post_media").insert(
    paths.map((photoPath, index) => ({
      post_id: postId,
      user_id: userId,
      photo_path: photoPath,
      position: firstPosition + index,
    })),
  );
  if (error) throw new StepError("Bilder speichern", error.message);
}

async function insertTags(postId: string, tagIds: string[]) {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const { error } = await supabase
    .from("post_tags")
    .upsert(
      unique.map((userId) => ({ post_id: postId, user_id: userId })),
      { ignoreDuplicates: true },
    );
  if (error) throw new StepError("Markierungen speichern", error.message);
}

/** Today's slideshow post of the current user, if there is one. */
export async function getTodaysDayPostId(): Promise<string | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", userId)
    .eq("workout_date", toDayKey(new Date()))
    .eq("is_day_post", true)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function createPost(input: NewPost): Promise<string> {
  const userId = await requireUserId();
  const paths = await uploadAll(userId, input.photoUris);
  const cover = paths[0];
  if (cover === undefined) throw new StepError("Post speichern", "Kein Bild ausgewählt.");

  const { data, error } = await supabase
    .from("posts")
    .insert({
      user_id: userId,
      photo_path: cover,
      caption: input.caption.length > 0 ? input.caption : null,
      workout_date: toDayKey(new Date()),
      in_feed: input.inFeed,
      is_day_post: input.isDayPost,
    })
    .select("id")
    .single();
  if (error) {
    await removePhotos(paths).catch(() => undefined);
    if (error.code === UNIQUE_VIOLATION) {
      throw new StepError("Post speichern", "Für heute gibt es schon eine Slideshow. Bitte versuche es erneut.");
    }
    throw new StepError("Post speichern", error.message);
  }

  try {
    await insertMedia(data.id, userId, paths, 0);
    await insertTags(data.id, input.tagIds);
  } catch (mediaError) {
    // Without its photos the post is broken: undo it completely.
    await supabase.from("posts").delete().eq("id", data.id);
    await removePhotos(paths).catch(() => undefined);
    throw mediaError;
  }
  return data.id;
}

/** Appends photos (and tags) to today's slideshow. */
export async function addToDayPost(postId: string, photoUris: string[], tagIds: string[]): Promise<void> {
  const userId = await requireUserId();
  const { data: last, error } = await supabase
    .from("post_media")
    .select("position")
    .eq("post_id", postId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const paths = await uploadAll(userId, photoUris);
  try {
    await insertMedia(postId, userId, paths, (last?.position ?? 0) + 1);
  } catch (mediaError) {
    await removePhotos(paths).catch(() => undefined);
    throw mediaError;
  }
  await insertTags(postId, tagIds);
}

/**
 * Signed photo URLs per post, in carousel order. Posts without media rows (created
 * before carousels existed) fall back to their cover photo.
 */
export async function fetchPostPhotoUrls(
  posts: { id: string; photo_path: string }[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (posts.length === 0) return result;
  const { data, error } = await supabase
    .from("post_media")
    .select("post_id, photo_path")
    .in(
      "post_id",
      posts.map((p) => p.id),
    )
    .order("position", { ascending: true });
  if (error) throw error;

  const pathsByPost = new Map<string, string[]>();
  for (const row of data) pathsByPost.set(row.post_id, [...(pathsByPost.get(row.post_id) ?? []), row.photo_path]);
  for (const post of posts) if (!pathsByPost.has(post.id)) pathsByPost.set(post.id, [post.photo_path]);

  const urls = await getSignedPhotoUrls([...pathsByPost.values()].flat());
  for (const [postId, paths] of pathsByPost) {
    result.set(
      postId,
      paths.flatMap((path) => {
        const url = urls.get(path);
        return url !== undefined ? [url] : [];
      }),
    );
  }
  return result;
}

/** Tagged people per post. */
export async function fetchPostTags(postIds: string[]): Promise<Map<string, PublicProfile[]>> {
  const result = new Map<string, PublicProfile[]>();
  if (postIds.length === 0) return result;
  const { data, error } = await supabase
    .from("post_tags")
    .select(`post_id, profile:profiles!post_tags_user_id_fkey(${PROFILE_COLUMNS})`)
    .in("post_id", postIds);
  if (error) throw error;
  const profiles = await toPublicProfiles(data.map((row) => row.profile));
  for (const row of data) {
    const profile = profiles.get(row.profile.id);
    if (profile !== undefined) result.set(row.post_id, [...(result.get(row.post_id) ?? []), profile]);
  }
  return result;
}
