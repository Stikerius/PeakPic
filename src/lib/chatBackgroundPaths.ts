/**
 * Chat backgrounds, the pure part (unit tested): where the picture lives on the device and how
 * big it may be. The picture stays on the device, only for me and only for that chat.
 */

/** Longest side of a stored background. */
export const CHAT_BACKGROUND_MAX_SIDE = 1600;
export const CHAT_BACKGROUNDS_FOLDER = "chat-backgrounds";

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * "chat-backgrounds/{userId}/{conversationId}.jpg", relative to the app's document folder. Ids
 * are checked so a strange value can never point anywhere else.
 */
export function chatBackgroundPath(userId: string, conversationId: string): string {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(conversationId)) throw new Error("invalid_id");
  return `${CHAT_BACKGROUNDS_FOLDER}/${userId}/${conversationId}.jpg`;
}

/** The folder with all backgrounds of one person (removed when the account is deleted). */
export function chatBackgroundUserFolder(userId: string): string {
  if (!SAFE_ID.test(userId)) throw new Error("invalid_id");
  return `${CHAT_BACKGROUNDS_FOLDER}/${userId}`;
}

/**
 * Size to scale a picture to so its longest side is at most `max`, keeping the aspect ratio.
 * null: it is small enough already (or the size is unknown).
 */
export function fitWithin(width: number, height: number, max: number = CHAT_BACKGROUND_MAX_SIDE): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= max) return null;
  const scale = max / longest;
  return width >= height
    ? { width: max, height: Math.max(1, Math.round(height * scale)) }
    : { width: Math.max(1, Math.round(width * scale)), height: max };
}

/** The picture to show, or null for the normal background (missing or empty file). */
export function backgroundUriOrNull(file: { exists: boolean; size: number | null; uri: string } | null): string | null {
  if (file === null || !file.exists || file.size === null || file.size <= 0) return null;
  return file.uri;
}
