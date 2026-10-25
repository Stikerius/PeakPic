import { remainingText, type OfficialItem } from "../../shared/surveys";
import type { FeedPost } from "@/types/social";

/** The official posts of the feed: on top (new, or pinned until answered) and the others by date. */
export type OfficialFeed = { top: OfficialItem[]; items: OfficialItem[] };

export const EMPTY_OFFICIAL_FEED: OfficialFeed = { top: [], items: [] };

export type FeedEntry = { type: "post"; key: string; post: FeedPost } | { type: "official"; key: string; item: OfficialItem };

const official = (item: OfficialItem): FeedEntry => ({ type: "official", key: `official:${item.itemId}`, item });

/**
 * The feed as shown: the cards on top first, then the posts with the other official cards put
 * between them by date. Official cards older than the last loaded post wait until there are no
 * more posts to load (so they don't jump around while scrolling).
 */
export function mergeFeed(posts: readonly FeedPost[], feed: OfficialFeed, hasMore: boolean): FeedEntry[] {
  const pending = [...feed.items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const out: FeedEntry[] = feed.top.map(official);
  for (const post of posts) {
    const at = Date.parse(post.createdAt);
    while (pending.length > 0 && Date.parse(pending[0]?.publishedAt ?? "") >= at) {
      const item = pending.shift();
      if (item !== undefined) out.push(official(item));
    }
    out.push({ type: "post", key: post.feedKey, post });
  }
  if (!hasMore) out.push(...pending.map(official));
  return out;
}

/** Hidden in this feed ("Ausblenden"): gone at once, the server knows it for next time. */
export function withoutItem(feed: OfficialFeed, itemId: string): OfficialFeed {
  return { top: feed.top.filter((i) => i.itemId !== itemId), items: feed.items.filter((i) => i.itemId !== itemId) };
}

/**
 * After taking part: the survey card leaves the feed at once (the server doesn't send it again).
 * It stays under "Einstellungen → Umfragen" with one's own answers. Results cards stay.
 */
export function withAnswered(feed: OfficialFeed, surveyId: string): OfficialFeed {
  const answered = (i: OfficialItem) => i.kind === "survey" && i.surveyId === surveyId;
  return { top: feed.top.filter((i) => !answered(i)), items: feed.items.filter((i) => !answered(i)) };
}

/** "Später" (or seen for a second): the card leaves the top and takes its place by date. */
export function withSeen(feed: OfficialFeed, itemId: string): OfficialFeed {
  const moved = feed.top.filter((i) => i.itemId === itemId && !i.pinUntilAnswered).map((i) => ({ ...i, seen: true }));
  return {
    top: feed.top.filter((i) => !moved.some((m) => m.itemId === i.itemId)).map((i) => (i.itemId === itemId ? { ...i, seen: true } : i)),
    items: [...feed.items, ...moved],
  };
}

/** "Offen · noch 3 Tage" / "Teilgenommen · noch 3 Tage" (settings list). */
export function surveyRowSubtitle(item: OfficialItem, now: Date): string {
  return `${item.answered ? "Teilgenommen" : "Offen"} · ${remainingText(item.endsAt, now)}`;
}
