import { describe, expect, it } from "@jest/globals";

import { sortStoryGroups } from "@/lib/storyOrder";
import type { StoryGroup } from "@/types/social";

function group(id: string, stories: { at: string; seen: boolean }[], isMine = false): StoryGroup {
  return {
    author: { id, username: id, avatarUrl: null },
    isMine,
    hasUnseen: stories.some((s) => !s.seen),
    stories: stories.map((s, index) => ({
      id: `${id}-${index}`,
      userId: id,
      photoUrl: null,
      createdAt: s.at,
      expiresAt: s.at,
      seen: s.seen,
      likedByMe: false,
      mentions: [],
    })),
  };
}

const ids = (groups: StoryGroup[]) => groups.map((g) => g.author.id);

describe("sortStoryGroups", () => {
  it("puts my group first, then unseen, then seen", () => {
    const sorted = sortStoryGroups([
      group("seen", [{ at: "2026-01-01T12:00:00Z", seen: true }]),
      group("unseen", [{ at: "2026-01-01T08:00:00Z", seen: false }]),
      group("me", [{ at: "2026-01-01T09:00:00Z", seen: true }], true),
    ]);
    expect(ids(sorted)).toEqual(["me", "unseen", "seen"]);
  });

  it("orders unseen groups by their newest unseen story", () => {
    const sorted = sortStoryGroups([
      // Newest story overall, but that one is already seen.
      group("a", [
        { at: "2026-01-01T08:00:00Z", seen: false },
        { at: "2026-01-01T20:00:00Z", seen: true },
      ]),
      group("b", [{ at: "2026-01-01T10:00:00Z", seen: false }]),
    ]);
    expect(ids(sorted)).toEqual(["b", "a"]);
  });

  it("orders completely seen groups by recency", () => {
    const sorted = sortStoryGroups([
      group("old", [{ at: "2026-01-01T08:00:00Z", seen: true }]),
      group("new", [{ at: "2026-01-01T18:00:00Z", seen: true }]),
    ]);
    expect(ids(sorted)).toEqual(["new", "old"]);
  });
});
