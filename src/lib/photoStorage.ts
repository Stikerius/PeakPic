import { Directory, File, Paths } from "expo-file-system";

const photosDir = new Directory(Paths.document, "photos");

/** Metadata file written by the first camera version; superseded by the workout repo. */
const legacyIndexFile = new File(photosDir, "index.json");

/**
 * Copies a temporary photo (camera/picker cache) into permanent app storage.
 * Returns the file name; resolve it with `getPhotoUri`, because the app container
 * path can change between installs.
 */
export async function copyIntoPhotoDir(sourceUri: string, id: string): Promise<string> {
  photosDir.create({ idempotent: true, intermediates: true });
  const source = new File(sourceUri);
  const fileName = `${id}${source.extension || ".jpg"}`;
  await source.copy(new File(photosDir, fileName));
  return fileName;
}

export function getPhotoUri(fileName: string): string {
  return new File(photosDir, fileName).uri;
}

/** Reads the legacy metadata file. Returns null if there is none. */
export async function readLegacyPhotoIndex(): Promise<unknown> {
  if (!legacyIndexFile.exists) return null;
  return JSON.parse(await legacyIndexFile.text());
}

export function deleteLegacyPhotoIndex(): void {
  if (legacyIndexFile.exists) legacyIndexFile.delete();
}
