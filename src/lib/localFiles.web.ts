// Local files in the browser: pictures are blob: or data: URLs (file input, canvas), there is no
// file system. Same functions as localFiles.ts.

/** The bytes behind a blob: or data: URL. */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Bild konnte nicht gelesen werden.");
  return new Uint8Array(await response.arrayBuffer());
}

/** JPEG bytes as a blob: URL (lives until the page is closed). */
export function writeTempJpeg(bytes: Uint8Array, _name: string): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
}
