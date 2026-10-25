import { resizeTarget } from "./surveyAdmin";

export type PreparedImage = { base64: string; width: number; height: number; bytes: number; type: string };

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Scales an image to at most 1600 pixels per side and encodes it again (WebP, else JPEG): this
 * also drops all metadata such as EXIF and location. The server checks the result again.
 */
export async function prepareSurveyImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Nur PNG, JPEG oder WebP (kein SVG).");
  if (file.size > 25 * 1024 * 1024) throw new Error("Die Datei ist zu gross (höchstens 25 MB vor dem Verkleinern).");
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = resizeTarget(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Das Bild konnte nicht verarbeitet werden.");
    context.drawImage(bitmap, 0, 0, width, height);
    for (const [type, quality] of [["image/webp", 0.85], ["image/jpeg", 0.85], ["image/jpeg", 0.7]] as const) {
      const blob = await toBlob(canvas, type, quality);
      // Some browsers can't encode WebP and return PNG instead: only take what was asked for.
      if (blob === null || blob.type !== type) continue;
      if (blob.size <= 2 * 1024 * 1024) return { base64: base64Of(await blob.arrayBuffer()), width, height, bytes: blob.size, type };
    }
    throw new Error("Das Bild bleibt auch verkleinert grösser als 2 MB.");
  } finally {
    bitmap.close();
  }
}
