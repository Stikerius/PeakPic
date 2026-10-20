import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { requireUserId } from "@/lib/session";
import { STORY_SELECT, groupStoryRows } from "@/lib/storyRepo";
import { supabase } from "@/lib/supabase";
import type { StoryGroup } from "@/types/social";

export const HIGHLIGHT_TITLE_MAX_LENGTH = 30;

export type Highlight = {
  id: string;
  userId: string;
  title: string;
  /** Signed URL of the cover story's photo (or the first story's); null if none is visible. */
  coverUrl: string | null;
  coverStoryId: string | null;
  storyIds: string[];
};

/** Where a story should go: an existing highlight or a new one with this title. */
export type HighlightChoice = { kind: "existing"; id: string; title: string } | { kind: "new"; title: string };

/** Highlights of a user, oldest first, as far as RLS lets me see them. */
export async function listHighlights(userId: string): Promise<Highlight[]> {
  const { data: highlights, error } = await supabase
    .from("highlights")
    .select("id, user_id, title, cover_story_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (highlights.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("highlight_items")
    .select("highlight_id, story_id, story:stories!highlight_items_story_id_fkey(created_at, photo_path)")
    .in(
      "highlight_id",
      highlights.map((h) => h.id),
    );
  if (itemsError) throw itemsError;

  const storiesByHighlight = new Map<string, { id: string; createdAt: string; photoPath: string }[]>();
  for (const item of items) {
    storiesByHighlight.set(item.highlight_id, [
      ...(storiesByHighlight.get(item.highlight_id) ?? []),
      { id: item.story_id, createdAt: item.story.created_at, photoPath: item.story.photo_path },
    ]);
  }
  const urls = await getSignedPhotoUrls(items.map((i) => i.story.photo_path));

  return highlights.map((h) => {
    const stories = (storiesByHighlight.get(h.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const cover = stories.find((s) => s.id === h.cover_story_id) ?? stories[0];
    return {
      id: h.id,
      userId: h.user_id,
      title: h.title,
      coverUrl: cover !== undefined ? (urls.get(cover.photoPath) ?? null) : null,
      coverStoryId: h.cover_story_id,
      storyIds: stories.map((s) => s.id),
    };
  });
}

export async function listMyHighlights(): Promise<Highlight[]> {
  return listHighlights(await requireUserId());
}

/** The stories of one highlight as a single viewer group (oldest first). */
export async function fetchHighlightGroup(highlightId: string): Promise<StoryGroup | null> {
  const userId = await requireUserId();
  const { data: items, error } = await supabase
    .from("highlight_items")
    .select("story_id")
    .eq("highlight_id", highlightId);
  if (error) throw error;
  if (items.length === 0) return null;
  const { data: rows, error: storiesError } = await supabase
    .from("stories")
    .select(STORY_SELECT)
    .in(
      "id",
      items.map((i) => i.story_id),
    )
    .order("created_at", { ascending: true });
  if (storiesError) throw storiesError;
  const [group] = await groupStoryRows(rows, userId);
  // In a highlight nothing counts as "new".
  return group !== undefined
    ? { ...group, hasUnseen: false, stories: group.stories.map((s) => ({ ...s, seen: true })) }
    : null;
}

export async function addStoryToHighlight(highlightId: string, storyId: string): Promise<void> {
  const { error } = await supabase
    .from("highlight_items")
    .upsert({ highlight_id: highlightId, story_id: storyId }, { ignoreDuplicates: true });
  if (error) throw error;
}

/** Puts a story into an existing highlight or a new one (with the story as cover). */
export async function applyHighlightChoice(choice: HighlightChoice, storyId: string): Promise<void> {
  if (choice.kind === "existing") {
    await addStoryToHighlight(choice.id, storyId);
    return;
  }
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("highlights")
    .insert({ user_id: userId, title: choice.title.trim(), cover_story_id: storyId })
    .select("id")
    .single();
  if (error) throw error;
  await addStoryToHighlight(data.id, storyId);
}

export async function removeStoryFromHighlight(highlightId: string, storyId: string): Promise<void> {
  const { error } = await supabase
    .from("highlight_items")
    .delete()
    .eq("highlight_id", highlightId)
    .eq("story_id", storyId);
  if (error) throw error;
}

export async function updateHighlight(
  highlightId: string,
  change: { title?: string; coverStoryId?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("highlights")
    .update({
      ...(change.title !== undefined ? { title: change.title.trim() } : {}),
      ...(change.coverStoryId !== undefined ? { cover_story_id: change.coverStoryId } : {}),
    })
    .eq("id", highlightId);
  if (error) throw error;
}

/** Deletes the highlight; its stories stay (they only lose this highlight). */
export async function deleteHighlight(highlightId: string): Promise<void> {
  const { error } = await supabase.from("highlights").delete().eq("id", highlightId);
  if (error) throw error;
}
