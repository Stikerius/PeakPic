import { File, Paths } from "expo-file-system";

// Local files, native: read a picture's bytes and write a temporary JPEG in the cache. The web
// has its own version (localFiles.web.ts) with fetch and blob URLs.

/** The bytes of a local file (camera, picker, image manipulator). */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

/** Writes JPEG bytes as a temporary file and returns its URI. */
export function writeTempJpeg(bytes: Uint8Array, name: string): string {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}
