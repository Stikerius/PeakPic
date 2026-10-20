import { useSyncExternalStore } from "react";

import { describeError } from "@/lib/errors";
import { applyHighlightChoice, type HighlightChoice } from "@/lib/highlightRepo";
import {
  addStory as addStoryRemote,
  type StoryExtras,
  deleteStory as deleteStoryRemote,
  fetchStoryGroups,
  markStorySeen,
  setStoryLiked,
} from "@/lib/storyRepo";
import { sortStoryGroups } from "@/lib/storyOrder";
import type { Story, StoryGroup } from "@/types/social";

/**
 * Shared story state for the feed's story bar and the full-screen viewer, so seen/liked
 * changes show up in both immediately. Group order only changes on a refresh or when the
 * viewer closes (resortStories), which keeps the viewer's position stable while stories
 * are being marked as seen.
 */
type StoryState = {
  groups: StoryGroup[];
  loading: boolean;
  uploading: boolean;
  error: string | null;
};

let state: StoryState = { groups: [], loading: true, uploading: false, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<StoryState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStories(): StoryState {
  return useSyncExternalStore(subscribe, () => state);
}

function updateStory(storyId: string, change: (story: Story) => Story) {
  setState({
    groups: state.groups.map((group) => {
      if (!group.stories.some((s) => s.id === storyId)) return group;
      const stories = group.stories.map((s) => (s.id === storyId ? change(s) : s));
      return { ...group, stories, hasUnseen: stories.some((s) => !s.seen) };
    }),
  });
}

export async function refreshStories(): Promise<void> {
  try {
    setState({ groups: await fetchStoryGroups(), loading: false, error: null });
  } catch {
    setState({ loading: false, error: "Storys konnten nicht geladen werden." });
  }
}

/** Re-applies the story bar order locally, e.g. after the viewer closed. */
export function resortStories(): void {
  setState({ groups: sortStoryGroups(state.groups) });
}

export function markSeen(story: Story): void {
  if (story.seen) return;
  updateStory(story.id, (s) => ({ ...s, seen: true }));
  markStorySeen(story.id).catch((error: unknown) =>
    console.warn("[stories] Gesehen-Status nicht gespeichert:", error),
  );
}

export async function toggleLike(story: Story): Promise<void> {
  const liked = !story.likedByMe;
  updateStory(story.id, (s) => ({ ...s, likedByMe: liked })); // optimistic
  try {
    await setStoryLiked(story.id, liked);
  } catch {
    updateStory(story.id, (s) => ({ ...s, likedByMe: !liked }));
  }
}

/** Uploads a story (optionally into a highlight) and reloads the bar. Returns an error message or null. */
export async function addStory(
  sourceUri: string,
  mentionedUserIds: string[] = [],
  highlight: HighlightChoice | null = null,
  extras?: StoryExtras,
): Promise<string | null> {
  setState({ uploading: true });
  try {
    const storyId = await addStoryRemote(sourceUri, mentionedUserIds, extras);
    await refreshStories();
    if (highlight !== null) {
      try {
        await applyHighlightChoice(highlight, storyId);
      } catch (highlightError) {
        console.error("[stories] Highlight speichern fehlgeschlagen:", highlightError);
        return `Story gepostet, aber nicht zum Highlight hinzugefügt – ${describeError(highlightError)}`;
      }
    }
    return null;
  } catch (error) {
    console.error("[stories] Story-Upload fehlgeschlagen:", error);
    return `Story konnte nicht hochgeladen werden – ${describeError(error)}`;
  } finally {
    setState({ uploading: false });
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  await deleteStoryRemote(storyId);
  setState({
    groups: state.groups
      .map((group) => ({ ...group, stories: group.stories.filter((s) => s.id !== storyId) }))
      .filter((group) => group.stories.length > 0),
  });
}
