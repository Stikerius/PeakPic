import { Directory, File, Paths } from "expo-file-system";

import type { LocalPhoto } from "@/types/photo";

const photosDir = new Directory(Paths.document, "photos");
const indexFile = new File(photosDir, "index.json");

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isLocalPhoto(value: unknown): value is LocalPhoto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.fileName === "string" &&
    (typeof v.caption === "string" || v.caption === null) &&
    typeof v.createdAt === "string"
  );
}

export function getLocalPhotoUri(photo: LocalPhoto): string {
  return new File(photosDir, photo.fileName).uri;
}

export async function listLocalPhotos(): Promise<LocalPhoto[]> {
  if (!indexFile.exists) return [];
  const parsed: unknown = JSON.parse(await indexFile.text());
  return Array.isArray(parsed) ? parsed.filter(isLocalPhoto) : [];
}

/** Copies a temporary photo (camera/picker cache) into permanent app storage. */
export async function saveLocalPhoto(
  sourceUri: string,
  caption: string,
): Promise<LocalPhoto> {
  photosDir.create({ idempotent: true, intermediates: true });

  const id = createId();
  const source = new File(sourceUri);
  const fileName = `${id}${source.extension || ".jpg"}`;
  await source.copy(new File(photosDir, fileName));

  const trimmed = caption.trim();
  const photo: LocalPhoto = {
    id,
    fileName,
    caption: trimmed.length > 0 ? trimmed : null,
    createdAt: new Date().toISOString(),
  };

  const existing = await listLocalPhotos();
  indexFile.write(JSON.stringify([photo, ...existing]));
  return photo;
}
