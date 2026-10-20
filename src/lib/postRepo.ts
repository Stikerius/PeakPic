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

export type EditablePost = {
  /** Current photos: signed URL for the editor, storage path to keep them unchanged. */
  photos: { url: string; path: string }[];
  caption: string;
  inFeed: boolean;
};

/** One of my posts with its photos, to open it in the editor again. */
export async function fetchPostForEdit(postId: string): Promise<EditablePost> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path, caption, in_feed")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const { data: media, error: mediaError } = await supabase
    .from("post_media")
    .select("photo_path")
    .eq("post_id", postId)
    .order("position", { ascending: true });
  if (mediaError) throw mediaError;
  const paths = media.length > 0 ? media.map((m) => m.photo_path) : [data.photo_path];
  const urls = await getSignedPhotoUrls(paths);
  return {
    photos: paths.flatMap((path) => {
      const url = urls.get(path);
      return url !== undefined ? [{ url, path }] : [];
    }),
    caption: data.caption ?? "",
    inFeed: data.in_feed,
  };
}

export type PostUpdate = {
  /** The new set of photos in carousel order; replaces the old ones. */
  photoUris: string[];
  /** URIs that are existing photos of the post, mapped to their storage path (kept as is). */
  existingPaths: Record<string, string>;
  caption: string;
  inFeed: boolean;
  /** Added to the existing tags. */
  tagIds: string[];
};

/**
 * Replaces photos and caption of one of my posts: photos can be added, removed, reordered
 * or edited, and a streak-only proof can be published to the feed. Unchanged photos keep
 * their file; files that are no longer used are removed once the new set is saved.
 */
export async function updatePost(postId: string, update: PostUpdate): Promise<void> {
  const userId = await requireUserId();
  const [post, media] = await Promise.all([
    supabase.from("posts").select("photo_path").eq("id", postId).eq("user_id", userId).single(),
    supabase.from("post_media").select("photo_path").eq("post_id", postId),
  ]);
  if (post.error) throw post.error;
  if (media.error) throw media.error;
  const oldPaths = [...new Set([post.data.photo_path, ...media.data.map((m) => m.photo_path)])];

  const newUris = update.photoUris.filter((uri) => update.existingPaths[uri] === undefined);
  const uploaded = await uploadAll(userId, newUris);
  const uploadedByUri = new Map(newUris.map((uri, index) => [uri, uploaded[index]]));
  const paths = update.photoUris.flatMap((uri) => {
    const path = update.existingPaths[uri] ?? uploadedByUri.get(uri);
    return path !== undefined ? [path] : [];
  });
  const cover = paths[0];
  if (cover === undefined) throw new StepError("Post speichern", "Kein Bild ausgewählt.");

  const { error } = await supabase
    .from("posts")
    .update({
      photo_path: cover,
      caption: update.caption.length > 0 ? update.caption : null,
      in_feed: update.inFeed,
    })
    .eq("id", postId)
    .eq("user_id", userId);
  if (error) {
    await removePhotos(uploaded).catch(() => undefined);
    throw new StepError("Post speichern", error.message);
  }

  const { error: deleteError } = await supabase.from("post_media").delete().eq("post_id", postId);
  if (deleteError) throw new StepError("Bilder ersetzen", deleteError.message);
  await insertMedia(postId, userId, paths, 0);
  await insertTags(postId, update.tagIds);
  await removePhotos(oldPaths.filter((path) => !paths.includes(path))).catch((removeError: unknown) =>
    console.warn("[post] Alte Fotos konnten nicht gelöscht werden:", removeError),
  );
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
