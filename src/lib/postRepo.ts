import { StepError } from "@/lib/errors";
import { getSignedPhotoUrls, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { parsePhotoEdits, type PhotoEdits } from "@/lib/photoEdits";
import { resolveUsernames } from "@/lib/tagSuggestRepo";
import { extractMentions } from "@/lib/taggedText";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { toDayKey } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { PhotoMention, PublicProfile } from "@/types/social";

/** One photo of a post as the editor hands it over. */
export type PostPhotoInput = {
  /** Storage paths of a photo the post already has; null for a new photo. */
  existing: { originalPath: string; photoPath: string } | null;
  /** The unedited original (local file for new photos). */
  originalUri: string;
  /** Rendered JPEG with the edits, if it has to be (re)uploaded. */
  renderedUri: string | null;
  edits: PhotoEdits | null;
  /** New photo or changed edits; unchanged existing photos keep their files. */
  changed: boolean;
};

export type NewPost = {
  /** In carousel order. */
  photos: PostPhotoInput[];
  caption: string;
  /** false: only a training proof for streak and calendar, not in the feed. */
  inFeed: boolean;
  /** The day's slideshow (first proof of the day) or an extra single post. */
  isDayPost: boolean;
  /** Shown in the profile grid (if it is also in the feed). */
  showInProfile: boolean;
  tagIds: string[];
  /** Unit of my plan this proof belongs to (checked by the database). */
  planDayId?: string | null;
};

/** Postgres unique_violation: a second day post for the same day. */
const UNIQUE_VIOLATION = "23505";

type MediaFiles = { photo_path: string; original_path: string; edits: PhotoEdits | null };

/**
 * Uploads what's needed for each photo: originals of new photos, renderings of edited
 * ones. Returns the storage paths per photo plus everything uploaded (for cleanup).
 */
async function savePhotos(
  userId: string,
  photos: PostPhotoInput[],
): Promise<{ files: MediaFiles[]; uploaded: string[] }> {
  const uploaded: string[] = [];
  const upload = async (uri: string) => {
    const path = await uploadPhoto(userId, "posts", uri);
    uploaded.push(path);
    return path;
  };
  try {
    const files: MediaFiles[] = [];
    for (const photo of photos) {
      if (photo.existing !== null && !photo.changed) {
        files.push({ photo_path: photo.existing.photoPath, original_path: photo.existing.originalPath, edits: photo.edits });
        continue;
      }
      const original = photo.existing?.originalPath ?? (await upload(photo.originalUri));
      // Without edits the original itself is shown.
      const rendered = photo.edits !== null && photo.renderedUri !== null ? await upload(photo.renderedUri) : original;
      files.push({ photo_path: rendered, original_path: original, edits: photo.edits });
    }
    return { files, uploaded };
  } catch (error) {
    await removePhotos(uploaded).catch(() => undefined);
    throw error;
  }
}

async function insertMedia(postId: string, userId: string, files: MediaFiles[], firstPosition: number) {
  const { error } = await supabase.from("post_media").insert(
    files.map((file, index) => ({
      post_id: postId,
      user_id: userId,
      photo_path: file.photo_path,
      original_path: file.original_path,
      edits: file.edits,
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

/** Makes the post's tags exactly `tagIds`: adds new ones, removes the others. */
async function setTags(postId: string, tagIds: string[]) {
  const keep = [...new Set(tagIds)];
  let remove = supabase.from("post_tags").delete().eq("post_id", postId);
  if (keep.length > 0) remove = remove.not("user_id", "in", `(${keep.join(",")})`);
  const { error } = await remove;
  if (error) throw new StepError("Markierungen speichern", error.message);
  await insertTags(postId, keep);
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
  const { files, uploaded } = await savePhotos(userId, input.photos);
  const cover = files[0];
  if (cover === undefined) throw new StepError("Post speichern", "Kein Bild ausgewählt.");

  const { data, error } = await supabase
    .from("posts")
    .insert({
      user_id: userId,
      photo_path: cover.photo_path,
      caption: input.caption.length > 0 ? input.caption : null,
      workout_date: toDayKey(new Date()),
      in_feed: input.inFeed,
      is_day_post: input.isDayPost,
      show_in_profile: input.showInProfile,
      plan_day_id: input.planDayId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    await removePhotos(uploaded).catch(() => undefined);
    if (error.code === UNIQUE_VIOLATION) {
      throw new StepError("Post speichern", "Für heute gibt es schon eine Slideshow. Bitte versuche es erneut.");
    }
    throw new StepError("Post speichern", error.message);
  }

  try {
    await insertMedia(data.id, userId, files, 0);
    await insertTags(data.id, input.tagIds);
  } catch (mediaError) {
    // Without its photos the post is broken: undo it completely.
    await supabase.from("posts").delete().eq("id", data.id);
    await removePhotos(uploaded).catch(() => undefined);
    throw mediaError;
  }
  return data.id;
}

/** Appends photos (and tags) to today's slideshow. */
export async function addToDayPost(postId: string, photos: PostPhotoInput[], tagIds: string[]): Promise<void> {
  const userId = await requireUserId();
  const { data: last, error } = await supabase
    .from("post_media")
    .select("position")
    .eq("post_id", postId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const { files, uploaded } = await savePhotos(userId, photos);
  try {
    await insertMedia(postId, userId, files, (last?.position ?? 0) + 1);
  } catch (mediaError) {
    await removePhotos(uploaded).catch(() => undefined);
    throw mediaError;
  }
  await insertTags(postId, tagIds);
}

export type EditablePhoto = {
  /** Signed URL of the unedited original, for the editor. */
  url: string;
  originalPath: string;
  photoPath: string;
  edits: PhotoEdits | null;
};

export type EditablePost = {
  photos: EditablePhoto[];
  tags: PublicProfile[];
  caption: string;
  inFeed: boolean;
  showInProfile: boolean;
};

/** One of my posts with originals and stored edits, to open it in the editor again. */
export async function fetchPostForEdit(postId: string): Promise<EditablePost> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("posts")
    .select("id, photo_path, caption, in_feed, show_in_profile")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const [media, tags] = await Promise.all([
    supabase
      .from("post_media")
      .select("photo_path, original_path, edits")
      .eq("post_id", postId)
      .order("position", { ascending: true }),
    fetchPostTags([postId]),
  ]);
  if (media.error) throw media.error;

  // Photos saved before originals were kept: the shown photo is all there is.
  const rows =
    media.data.length > 0
      ? media.data.map((m) => ({
          photoPath: m.photo_path,
          originalPath: m.original_path ?? m.photo_path,
          edits: m.original_path !== null ? parsePhotoEdits(m.edits) : null,
        }))
      : [{ photoPath: data.photo_path, originalPath: data.photo_path, edits: null }];
  const urls = await getSignedPhotoUrls(rows.map((r) => r.originalPath));
  return {
    photos: rows.flatMap((row) => {
      const url = urls.get(row.originalPath);
      return url !== undefined ? [{ ...row, url }] : [];
    }),
    tags: tags.get(postId) ?? [],
    caption: data.caption ?? "",
    inFeed: data.in_feed,
    showInProfile: data.show_in_profile,
  };
}

export type PostUpdate = {
  /** The new set of photos in carousel order; replaces the old ones. */
  photos: PostPhotoInput[];
  caption: string;
  inFeed: boolean;
  showInProfile: boolean;
  /** The post's tags afterwards (removed people are untagged). */
  tagIds: string[];
};

/**
 * Updates one of my posts: photos can be added, removed, reordered or edited again from
 * their originals, and a streak-only proof can be published to the feed. Unchanged photos
 * keep their files; files no longer used are removed once the new set is saved.
 */
export async function updatePost(postId: string, update: PostUpdate): Promise<void> {
  const userId = await requireUserId();
  const [post, media] = await Promise.all([
    supabase.from("posts").select("photo_path").eq("id", postId).eq("user_id", userId).single(),
    supabase.from("post_media").select("photo_path, original_path").eq("post_id", postId),
  ]);
  if (post.error) throw post.error;
  if (media.error) throw media.error;
  const oldPaths = new Set([
    post.data.photo_path,
    ...media.data.flatMap((m) => (m.original_path !== null ? [m.photo_path, m.original_path] : [m.photo_path])),
  ]);

  const { files, uploaded } = await savePhotos(userId, update.photos);
  const cover = files[0];
  if (cover === undefined) throw new StepError("Post speichern", "Kein Bild ausgewählt.");

  const { error } = await supabase
    .from("posts")
    .update({
      photo_path: cover.photo_path,
      caption: update.caption.length > 0 ? update.caption : null,
      in_feed: update.inFeed,
      show_in_profile: update.showInProfile,
    })
    .eq("id", postId)
    .eq("user_id", userId);
  if (error) {
    await removePhotos(uploaded).catch(() => undefined);
    throw new StepError("Post speichern", error.message);
  }

  const { error: deleteError } = await supabase.from("post_media").delete().eq("post_id", postId);
  if (deleteError) throw new StepError("Bilder ersetzen", deleteError.message);
  await insertMedia(postId, userId, files, 0);
  await setTags(postId, update.tagIds);

  const stillUsed = new Set(files.flatMap((f) => [f.photo_path, f.original_path]));
  await removePhotos([...oldPaths].filter((path) => !stillUsed.has(path))).catch((removeError: unknown) =>
    console.warn("[post] Alte Fotos konnten nicht gelöscht werden:", removeError),
  );
}

/** "Im Profil anzeigen" for one of my posts. */
export async function setPostShownInProfile(postId: string, show: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("posts")
    .update({ show_in_profile: show })
    .eq("id", postId)
    .eq("user_id", userId);
  if (error) throw error;
}

export type PostPhoto = { url: string; mentions: PhotoMention[] };

/**
 * Photos per post in carousel order: signed URL plus the @mentions drawn on it (from the
 * stored edits, so they can be tapped). Posts without media rows (created before carousels
 * existed) fall back to their cover photo.
 */
export async function fetchPostPhotos(
  posts: { id: string; photo_path: string }[],
): Promise<Map<string, PostPhoto[]>> {
  const result = new Map<string, PostPhoto[]>();
  if (posts.length === 0) return result;
  const { data, error } = await supabase
    .from("post_media")
    .select("post_id, photo_path, edits")
    .in(
      "post_id",
      posts.map((p) => p.id),
    )
    .order("position", { ascending: true });
  if (error) throw error;

  type Entry = { path: string; mentions: PhotoMention[]; textMentions: { username: string; x: number; y: number }[] };
  const byPost = new Map<string, Entry[]>();
  for (const row of data) {
    const items = parsePhotoEdits(row.edits)?.items ?? [];
    const mentions = items.flatMap((item) =>
      item.kind === "mention" ? [{ userId: item.user.id, username: item.user.username, x: item.x, y: item.y }] : [],
    );
    // @names typed into texts on the photo, tappable at the text.
    const textMentions = items.flatMap((item) =>
      item.kind === "text" ? extractMentions(item.text).map((username) => ({ username, x: item.x, y: item.y })) : [],
    );
    byPost.set(row.post_id, [...(byPost.get(row.post_id) ?? []), { path: row.photo_path, mentions, textMentions }]);
  }
  const textNames = [...new Set([...byPost.values()].flat().flatMap((e) => e.textMentions.map((m) => m.username)))];
  const textProfiles = textNames.length > 0 ? await resolveUsernames(textNames) : new Map<string, PublicProfile | null>();
  for (const entries of byPost.values()) {
    for (const entry of entries) {
      for (const m of entry.textMentions) {
        const profile = textProfiles.get(m.username);
        if (profile != null) entry.mentions.push({ userId: profile.id, username: profile.username, x: m.x, y: m.y });
      }
    }
  }
  for (const post of posts) {
    if (!byPost.has(post.id)) byPost.set(post.id, [{ path: post.photo_path, mentions: [], textMentions: [] }]);
  }

  const urls = await getSignedPhotoUrls([...byPost.values()].flat().map((e) => e.path));
  for (const [postId, entries] of byPost) {
    result.set(
      postId,
      entries.flatMap((entry) => {
        const url = urls.get(entry.path);
        return url !== undefined ? [{ url, mentions: entry.mentions }] : [];
      }),
    );
  }
  return result;
}

/** Signed photo URLs per post, in carousel order. */
export async function fetchPostPhotoUrls(
  posts: { id: string; photo_path: string }[],
): Promise<Map<string, string[]>> {
  const photos = await fetchPostPhotos(posts);
  return new Map([...photos].map(([postId, list]) => [postId, list.map((p) => p.url)]));
}

/** Tagged people per post. */
export async function fetchPostTags(postIds: string[]): Promise<Map<string, PublicProfile[]>> {
  const result = new Map<string, PublicProfile[]>();
  if (postIds.length === 0) return result;
  const { data, error } = await supabase
    .from("post_tags")
    .select(`post_id, profile:profiles!post_tags_user_id_fkey!inner(${PROFILE_COLUMNS})`)
    .in("post_id", postIds);
  if (error) throw error;
  const profiles = await toPublicProfiles(data.map((row) => row.profile));
  for (const row of data) {
    const profile = profiles.get(row.profile.id);
    if (profile !== undefined) result.set(row.post_id, [...(result.get(row.post_id) ?? []), profile]);
  }
  return result;
}
