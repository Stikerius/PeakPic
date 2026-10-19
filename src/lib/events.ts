/**
 * Tiny in-app event bus so screens can react to changes made elsewhere
 * (e.g. the feed picking up a post created in the camera tab).
 */
type AppEvents = {
  postCreated: undefined;
  commentAdded: { postId: string };
};

type Listeners = { [K in keyof AppEvents]: Set<(payload: AppEvents[K]) => void> };

const listeners: Listeners = {
  postCreated: new Set(),
  commentAdded: new Set(),
};

export function emitAppEvent<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
  for (const listener of listeners[event]) listener(payload);
}

/** Returns an unsubscribe function, so it can be returned from useEffect directly. */
export function onAppEvent<K extends keyof AppEvents>(
  event: K,
  listener: (payload: AppEvents[K]) => void,
): () => void {
  listeners[event].add(listener);
  return () => {
    listeners[event].delete(listener);
  };
}
