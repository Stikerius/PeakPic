import { useEffect, useRef, useState } from "react";

import { onAppEvent } from "@/lib/events";
import { fetchFeedPage, setPostLiked } from "@/lib/feedRepo";
import type { FeedPost } from "@/types/social";

type FeedStatus = "loading" | "refreshing" | "loadingMore" | "idle";
/** "silent" refreshes in the background without showing a spinner. */
type RefreshMode = "loading" | "refreshing" | "silent";

export function useFeed() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  // Bumped on every first-page load so stale responses (e.g. a slow "load more") are dropped.
  const generation = useRef(0);
  const pendingLikes = useRef(new Set<string>());

  async function loadFirstPage(mode: RefreshMode) {
    const current = ++generation.current;
    if (mode !== "silent") setStatus(mode);
    try {
      const page = await fetchFeedPage(null);
      if (current !== generation.current) return;
      setPosts(page.posts);
      setCursor(page.nextCursor);
      setError(null);
    } catch {
      if (current === generation.current) setError("Feed konnte nicht geladen werden.");
    } finally {
      if (current === generation.current) setStatus("idle");
    }
  }

  async function loadMore() {
    if (status !== "idle" || cursor === null) return;
    const current = generation.current;
    setStatus("loadingMore");
    try {
      const page = await fetchFeedPage(cursor);
      if (current !== generation.current) return;
      setPosts((prev) => {
        const known = new Set(prev.map((p) => p.id));
        return [...prev, ...page.posts.filter((p) => !known.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      if (current === generation.current) setError("Weitere Posts konnten nicht geladen werden.");
    } finally {
      if (current === generation.current) setStatus("idle");
    }
  }

  async function toggleLike(postId: string) {
    const post = posts.find((p) => p.id === postId);
    if (post === undefined || pendingLikes.current.has(postId)) return;
    const liked = !post.likedByMe;
    const apply = (value: boolean) =>
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId && p.likedByMe !== value
            ? { ...p, likedByMe: value, likeCount: Math.max(0, p.likeCount + (value ? 1 : -1)) }
            : p,
        ),
      );

    apply(liked); // optimistic
    pendingLikes.current.add(postId);
    try {
      await setPostLiked(postId, liked);
    } catch {
      apply(!liked);
      setError("Like konnte nicht gespeichert werden.");
    } finally {
      pendingLikes.current.delete(postId);
    }
  }

  useEffect(() => {
    void loadFirstPage("loading");
    const unsubscribers = [
      onAppEvent("postCreated", () => void loadFirstPage("silent")),
      onAppEvent("followChanged", () => void loadFirstPage("silent")),
      onAppEvent("postDeleted", ({ postId }) =>
        setPosts((prev) => prev.filter((p) => p.id !== postId)),
      ),
      onAppEvent("commentAdded", ({ postId }) =>
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p)),
        ),
      ),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // Mount-only: loadFirstPage reads refs and setters, which are stable.
  }, []);

  return {
    posts,
    status,
    error,
    hasMore: cursor !== null,
    refresh: () => loadFirstPage("refreshing"),
    loadMore,
    toggleLike,
    dismissError: () => setError(null),
  };
}
