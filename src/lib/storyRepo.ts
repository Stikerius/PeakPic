import { getSignedPhotoUrls, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { getFollowingIds } from "@/lib/socialRepo";
import { sortStoryGroups } from "@/lib/storyOrder";
import { supabase } from "@/lib/supabase";
import type { PublicProfile, Story, StoryGroup } from "@/types/social";

/**
 * Active stories (not expired) of people I follow, my own, and stories I'm tagged in,
 * grouped by author, in story bar order (see sortStoryGroups).
 */
export const STORY_SELECT =
  "id, user_id, photo_path, created_at, expires_at, mentioned_user_ids, author:profiles!stories_user_id_fkey(id, username, avatar_path)";

export type StoryRow = {
  id: string;
  user_id: string;
  photo_path: string;
  created_at: string;
  expires_at: string;
  mentioned_user_ids: string[];
  author: { id: string; username: string; avatar_path: string | null };
};

export async function fetchStoryGroups(): Promise<StoryGroup[]> {
  const userId = await requireUserId();
  const authorIds = [userId, ...(await getFollowingIds())];

  const { data: rows, error } = await supabase
    .from("stories")
    .select(STORY_SELECT)
    .or(`user_id.in.(${authorIds.join(",")}),mentioned_user_ids.cs.{${userId}}`)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return sortStoryGroups(await groupStoryRows(rows, userId));
}

/** Stories with photos, seen/liked state and mentions, grouped by author (oldest first). */
export async function groupStoryRows(rows: StoryRow[], userId: string): Promise<StoryGroup[]> {
  if (rows.length === 0) return [];
  const storyIds = rows.map((r) => r.id);
  const mentionedIds = [...new Set(rows.flatMap((r) => r.mentioned_user_ids))];
  const [viewsResult, likesResult, mentionedResult, photoUrls, authors] = await Promise.all([
    supabase.from("story_views").select("story_id").eq("user_id", userId).in("story_id", storyIds),
    supabase.from("story_likes").select("story_id").eq("user_id", userId).in("story_id", storyIds),
    supabase.from("profiles").select(PROFILE_COLUMNS).in("id", mentionedIds),
    getSignedPhotoUrls(rows.map((r) => r.photo_path)),
    toPublicProfiles(rows.map((r) => r.author)),
  ]);
  if (viewsResult.error) throw viewsResult.error;
  if (likesResult.error) throw likesResult.error;
  if (mentionedResult.error) throw mentionedResult.error;
  const mentionedProfiles = await toPublicProfiles(mentionedResult.data);
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
      mentions: row.mentioned_user_ids.flatMap((id) => {
        const profile = mentionedProfiles.get(id);
        return profile !== undefined ? [profile] : [];
      }),
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

  return [...groups.values()];
}

/** Returns the new story's id. */
export async function addStory(sourceUri: string, mentionedUserIds: string[]): Promise<string> {
  const userId = await requireUserId();
  const photoPath = await uploadPhoto(userId, "stories", sourceUri);
  const { data, error } = await supabase
    .from("stories")
    .insert({ user_id: userId, photo_path: photoPath, mentioned_user_ids: mentionedUserIds })
    .select("id")
    .single();
  if (error) {
    await removePhotos([photoPath]).catch(() => undefined);
    throw error;
  }
  return data.id;
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

export type StoryViewer = { profile: PublicProfile; liked: boolean; at: string };
export type StoryActivity = { viewers: StoryViewer[]; viewCount: number; likeCount: number };

/** Who viewed and liked one of my stories (readable only by the story owner). */
export async function fetchStoryActivity(storyId: string): Promise<StoryActivity> {
  const [views, likes] = await Promise.all([
    supabase
      .from("story_views")
      .select(`viewed_at, profile:profiles!story_views_user_id_fkey(${PROFILE_COLUMNS})`)
      .eq("story_id", storyId),
    supabase
      .from("story_likes")
      .select(`created_at, profile:profiles!story_likes_user_id_fkey(${PROFILE_COLUMNS})`)
      .eq("story_id", storyId),
  ]);
  if (views.error) throw views.error;
  if (likes.error) throw likes.error;

  const profiles = await toPublicProfiles([
    ...views.data.map((v) => v.profile),
    ...likes.data.map((l) => l.profile),
  ]);
  const likedIds = new Set(likes.data.map((l) => l.profile.id));
  const byUser = new Map<string, StoryViewer>();
  for (const view of views.data) {
    const profile = profiles.get(view.profile.id);
    if (profile) byUser.set(profile.id, { profile, liked: likedIds.has(profile.id), at: view.viewed_at });
  }
  // Likes without a recorded view (shouldn't happen, but don't lose them).
  for (const like of likes.data) {
    const profile = profiles.get(like.profile.id);
    if (profile && !byUser.has(profile.id)) byUser.set(profile.id, { profile, liked: true, at: like.created_at });
  }

  const viewers = [...byUser.values()].sort((a, b) => {
    if (a.liked !== b.liked) return a.liked ? -1 : 1;
    return b.at.localeCompare(a.at);
  });
  return { viewers, viewCount: viewers.length, likeCount: likedIds.size };
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
