import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { backgroundUriOrNull, CHAT_BACKGROUNDS_FOLDER, chatBackgroundPath, fitWithin } from "@/lib/chatBackgroundPaths";

/**
 * A chat background picked from the gallery. It never leaves the device: scaled down, re-encoded
 * as JPEG (which drops EXIF data such as the location) and stored in the app's documents under
 * chat-backgrounds/{userId}/{conversationId}.jpg. Only for me, only for that chat.
 */

const JPEG_QUALITY = 0.85;

function backgroundFile(userId: string, conversationId: string): File {
  const [folder, user, name] = chatBackgroundPath(userId, conversationId).split("/");
  return new File(Paths.document, folder ?? CHAT_BACKGROUNDS_FOLDER, user ?? userId, name ?? `${conversationId}.jpg`);
}

/** The stored picture, or null for the normal background (also when the file is missing). */
export function getChatBackgroundUri(userId: string, conversationId: string): string | null {
  try {
    const file = backgroundFile(userId, conversationId);
    return backgroundUriOrNull({ exists: file.exists, size: file.exists ? file.size : null, uri: file.uri });
  } catch {
    return null;
  }
}

export class ChatBackgroundError extends Error {}

/** Scales, re-encodes and stores the picture as this chat's background. */
export async function saveChatBackground(userId: string, conversationId: string, sourceUri: string): Promise<void> {
  try {
    const original = await ImageManipulator.manipulate(sourceUri).renderAsync();
    const size = fitWithin(original.width, original.height);
    const image = size !== null ? await ImageManipulator.manipulate(sourceUri).resize(size).renderAsync() : original;
    const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    const target = backgroundFile(userId, conversationId);
    target.parentDirectory.create({ idempotent: true, intermediates: true });
    await new File(saved.uri).move(target, { overwrite: true });
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    throw new ChatBackgroundError(
      /space|ENOSPC|full|storage/i.test(text)
        ? "Nicht genug Speicherplatz auf dem Gerät. Gib etwas Platz frei und versuche es erneut."
        : "Das Bild konnte nicht als Hintergrund gespeichert werden.",
    );
  }
}

/** "Standard wiederherstellen": deletes this chat's picture. */
export function resetChatBackground(userId: string, conversationId: string): void {
  try {
    const file = backgroundFile(userId, conversationId);
    if (file.exists) file.delete();
  } catch {
    // nothing stored, or already gone
  }
}

/** All backgrounds of one person on this device (deleting the account). */
export function deleteAllChatBackgrounds(userId: string): void {
  try {
    const folder = new Directory(Paths.document, CHAT_BACKGROUNDS_FOLDER, userId);
    if (folder.exists) folder.delete();
  } catch {
    // best effort
  }
}
