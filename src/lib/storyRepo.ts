import { getSignedPhotoUrls, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { getFollowingIds } from "@/lib/socialRepo";
import { supabase } from "@/lib/supabase";
import type { Story, StoryGroup } from "@/types/social";

/**
 * Active stories (not expired) of people I follow plus my own, grouped by author.
 * Order: my group first, then groups with unseen stories (newest first), then seen ones.
 */
export async function fetchStoryGroups(): Promise<StoryGroup[]> {
  const userId = await requireUserId();
  const authorIds = [userId, ...(await getFollowingIds())];

  const { data: rows, error } = await supabase
    .from("stories")
    .select(
      "id, user_id, photo_path, created_at, expires_at, author:profiles!stories_user_id_fkey(id, username, avatar_path)",
    )
    .in("user_id", authorIds)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (rows.length === 0) return [];

  const storyIds = rows.map((r) => r.id);
  const [viewsResult, likesResult, photoUrls, authors] = await Promise.all([
    supabase.from("story_views").select("story_id").eq("user_id", userId).in("story_id", storyIds),
    supabase.from("story_likes").select("story_id").eq("user_id", userId).in("story_id", storyIds),
    getSignedPhotoUrls(rows.map((r) => r.photo_path)),
    toPublicProfiles(rows.map((r) => r.author)),
  ]);
  if (viewsResult.error) throw viewsResult.error;
  if (likesResult.error) throw likesResult.error;
  const seen = new Set(viewsResult.data.map((v) => v.story_id));
  const liked = new Set(likesResult.data.map((l) => l.story_id));

  const groups = new Map<string, StoryGroup>();
  for (const row of rows) {
    const isMine = row.user_id === userId;
    const story: Story = {
      id: row.id,
      userId: row.user_id,
      photoUrl: photoUrls.get(row.photo_path) ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      // Your own stories never count as unseen.
      seen: isMine || seen.has(row.id),
      likedByMe: liked.has(row.id),
    };
    const group = groups.get(row.user_id);
    if (group === undefined) {
      groups.set(row.user_id, {
        author: authors.get(row.user_id) ?? {
          id: row.author.id,
          username: row.author.username,
          avatarUrl: null,
        },
        stories: [story],
        isMine,
        hasUnseen: !story.seen,
      });
    } else {
      group.stories.push(story);
      group.hasUnseen ||= !story.seen;
    }
  }

  const latest = (g: StoryGroup) => g.stories[g.stories.length - 1]?.createdAt ?? "";
  return [...groups.values()].sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return latest(b).localeCompare(latest(a));
  });
}

export async function addStory(sourceUri: string): Promise<void> {
  const userId = await requireUserId();
  const photoPath = await uploadPhoto(userId, "stories", sourceUri);
  const { error } = await supabase.from("stories").insert({ user_id: userId, photo_path: photoPath });
  if (error) {
    await removePhotos([photoPath]).catch(() => undefined);
    throw error;
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("stories")
    .delete()
    .eq("id", storyId)
    .eq("user_id", userId)
    .select("photo_path");
  if (error) throw error;
  await removePhotos(data.map((row) => row.photo_path)).catch((removeError: unknown) =>
    console.warn("[stories] Foto konnte nicht gelöscht werden:", removeError),
  );
}

export async function markStorySeen(storyId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("story_views")
    .upsert({ story_id: storyId, user_id: userId }, { ignoreDuplicates: true });
  if (error) throw error;
}

export async function setStoryLiked(storyId: string, liked: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = liked
    ? await supabase
        .from("story_likes")
        .upsert({ story_id: storyId, user_id: userId }, { ignoreDuplicates: true })
    : await supabase.from("story_likes").delete().eq("story_id", storyId).eq("user_id", userId);
  if (error) throw error;
}
