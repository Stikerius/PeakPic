import type { StoryGroup } from "@/types/social";

/** Newest story that counts for the order: the newest unseen one while there are any. */
function sortKey(group: StoryGroup): string {
  const relevant = group.hasUnseen ? group.stories.filter((s) => !s.seen) : group.stories;
  return relevant[relevant.length - 1]?.createdAt ?? "";
}

/**
 * Story bar order: my group first, then everyone with unseen stories (newest unseen first),
 * then the people I've seen completely (newest first).
 */
export function sortStoryGroups(groups: StoryGroup[]): StoryGroup[] {
  return [...groups].sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return sortKey(b).localeCompare(sortKey(a));
  });
}
