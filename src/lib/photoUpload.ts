import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { step } from "@/lib/errors";
import { PHOTO_BUCKET, SIGNED_URL_TTL, supabase } from "@/lib/supabase";

/** Longest edge of uploaded photos in px. */
const MAX_DIMENSION = 1440;
const JPEG_QUALITY = 0.8;

export type PhotoKind = "posts" | "stories" | "avatar";

/** Downscales to MAX_DIMENSION and re-encodes as JPEG. Returns a local file URI. */
async function preparePhoto(sourceUri: string): Promise<string> {
  const original = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const longest = Math.max(original.width, original.height);
  const image =
    longest > MAX_DIMENSION
      ? await ImageManipulator.manipulate(sourceUri)
          .resize(
            original.width >= original.height
              ? { width: MAX_DIMENSION, height: null }
              : { width: null, height: MAX_DIMENSION },
          )
          .renderAsync()
      : original;
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return saved.uri;
}

function createFileName(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
}

/** Uploads a local photo to `{userId}/{kind}/...` in the private bucket. Returns the storage path. */
export async function uploadPhoto(
  userId: string,
  kind: PhotoKind,
  sourceUri: string,
): Promise<string> {
  const preparedUri = await step("Bild verarbeiten", () => preparePhoto(sourceUri));
  // Pass the Uint8Array itself: File.arrayBuffer() returns `bytes.buffer`, which may be
  // larger than the file if the native side hands out a view into a bigger buffer.
  const bytes = await step("Bild lesen", () => new File(preparedUri).bytes());
  const path = `${userId}/${kind}/${createFileName()}`;
  await step("Hochladen", async () => {
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
  });
  return path;
}

export async function removePhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  if (error) throw error;
}

/** Signed URLs for private photos, keyed by storage path. Paths without access are left out. */
export async function getSignedPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return urls;
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL);
  if (error) throw error;
  for (const entry of data) {
    if (entry.path !== null && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

export async function getSignedPhotoUrl(path: string): Promise<string | null> {
  return (await getSignedPhotoUrls([path])).get(path) ?? null;
}
