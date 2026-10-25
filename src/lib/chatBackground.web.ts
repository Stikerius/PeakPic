import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { chatBackgroundPath, fitWithin } from "@/lib/chatBackgroundPaths";

/**
 * Chat backgrounds in the browser: the same rules as on the phone (only for me, only for that
 * chat, never uploaded), stored in this browser's localStorage as a small JPEG (data URL). The
 * picture is scaled down further than on the phone (browser storage is small) and re-encoded,
 * which drops EXIF data such as the location.
 */

const WEB_MAX_SIDE = 1080;
const JPEG_QUALITY = 0.75;
/** Data URLs above this size are refused (localStorage holds about 5 MB per site). */
const MAX_DATA_URL_CHARS = 1_500_000;
const PREFIX = "peakpic.chatBackground.";

function keyFor(userId: string, conversationId: string): string {
  // Checks the ids exactly like the phone's file path does.
  return PREFIX + chatBackgroundPath(userId, conversationId);
}

export function getChatBackgroundUri(userId: string, conversationId: string): string | null {
  try {
    const value = window.localStorage.getItem(keyFor(userId, conversationId));
    return value !== null && value.startsWith("data:image/jpeg;base64,") ? value : null;
  } catch {
    return null;
  }
}

export class ChatBackgroundError extends Error {}

export async function saveChatBackground(userId: string, conversationId: string, sourceUri: string): Promise<void> {
  let dataUrl: string;
  try {
    const original = await ImageManipulator.manipulate(sourceUri).renderAsync();
    const size = fitWithin(original.width, original.height, WEB_MAX_SIDE);
    const image = size !== null ? await ImageManipulator.manipulate(sourceUri).resize(size).renderAsync() : original;
    const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
    if (saved.base64 === undefined) throw new Error("no_data");
    dataUrl = `data:image/jpeg;base64,${saved.base64}`;
  } catch {
    throw new ChatBackgroundError("Das Bild konnte nicht als Hintergrund gespeichert werden.");
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new ChatBackgroundError("Das Bild ist für den Browser-Speicher zu gross. Bitte wähle ein kleineres Bild.");
  }
  try {
    window.localStorage.setItem(keyFor(userId, conversationId), dataUrl);
  } catch {
    throw new ChatBackgroundError("Nicht genug Speicherplatz im Browser. Entferne andere Chat-Hintergründe und versuche es erneut.");
  }
}

export function resetChatBackground(userId: string, conversationId: string): void {
  try {
    window.localStorage.removeItem(keyFor(userId, conversationId));
  } catch {
    // nothing stored
  }
}

export function deleteAllChatBackgrounds(userId: string): void {
  try {
    const prefix = keyFor(userId, "x").replace(/x\.jpg$/, "");
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // best effort
  }
}
