/**
 * Double tap on a post photo: likes, never unlikes. Pure decision plus the optimistic flow, so it
 * can be unit tested without React. The heart below the post stays the only way to remove a like.
 */

/** "liked": a new like was sent; "already": only the animation runs, nothing goes to the server. */
export type DoubleTapResult = "liked" | "already";

export type DoubleTapLikeInput = {
  postId: string;
  /** What the screen shows right now (optimistic state included). */
  liked: boolean;
  /** Posts with a like request in flight (shared with the heart button of the screen). */
  pending: Set<string>;
  /** Shows the like (true) or takes it back (false) in the UI. */
  apply: (liked: boolean) => void;
  /** Stores the like on the server (idempotent: a second like of the same post is ignored). */
  send: (postId: string) => Promise<void>;
  /** The server refused or the network is gone (the like has already been taken back). */
  onFailed: (error: unknown) => void;
};

export function doubleTapLike({ postId, liked, pending, apply, send, onFailed }: DoubleTapLikeInput): DoubleTapResult {
  // Already liked, or a request for this post is still on its way: no second request.
  if (liked || pending.has(postId)) return "already";
  apply(true);
  pending.add(postId);
  send(postId)
    .catch((error: unknown) => {
      apply(false);
      onFailed(error);
    })
    .finally(() => pending.delete(postId));
  return "liked";
}

/** Where the big heart may be centred so it stays fully inside the photo. */
export function clampBurstCenter(
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
): { x: number; y: number } {
  const half = size / 2;
  const clamp = (value: number, max: number) => (max <= half * 2 ? max / 2 : Math.min(Math.max(value, half), max - half));
  return { x: clamp(x, width), y: clamp(y, height) };
}
