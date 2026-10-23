import { useCallback, useEffect, useRef, useState } from "react";

export type Page<T> = { items: T[]; nextCursor: string | null };

export type PagedList<T> = {
  /** null until the first page has arrived. */
  items: T[] | null;
  failed: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Pull to refresh (shows the spinner). */
  refresh: () => void;
  /** Reload quietly, e.g. after a post was created elsewhere (only once loaded). */
  reload: () => void;
  loadMore: () => void;
  retry: () => void;
};

/**
 * A cursor-paged list that loads its first page only once `enabled` turns true (a profile tab
 * that is opened for the first time) and keeps everything while it is hidden again.
 * `fetchPage` must be stable (useCallback).
 */
export function usePagedList<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, enabled: boolean): PagedList<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const started = useRef(false);
  // Answers of an older request (before a refresh) are dropped.
  const generation = useRef(0);

  const loadFirst = useCallback(() => {
    const current = ++generation.current;
    return fetchPage(null)
      .then((page) => {
        if (current !== generation.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setFailed(false);
      })
      .catch(() => {
        if (current === generation.current) setFailed(true);
      });
  }, [fetchPage]);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void loadFirst();
  }, [enabled, loadFirst]);

  const refresh = useCallback(() => {
    started.current = true;
    setRefreshing(true);
    void loadFirst().finally(() => setRefreshing(false));
  }, [loadFirst]);

  const reload = useCallback(() => {
    if (started.current) void loadFirst();
  }, [loadFirst]);

  const retry = useCallback(() => {
    setFailed(false);
    started.current = true;
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore || items === null) return;
    const current = generation.current;
    setLoadingMore(true);
    fetchPage(cursor)
      .then((page) => {
        if (current !== generation.current) return;
        setItems((previous) => [...(previous ?? []), ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, items, fetchPage]);

  return { items, failed, refreshing, loadingMore, hasMore: cursor !== null, refresh, reload, loadMore, retry };
}
