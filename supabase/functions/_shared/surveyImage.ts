// Checks an uploaded survey image by its bytes (never by its name or declared type): PNG, JPEG
// or WebP recognised by their magic bytes, at most 2 MB, at most 1600 pixels per side. SVG and
// everything else is refused. Pure, no imports (unit tested in the app's tests).

export const SURVEY_IMAGE_LIMITS = { maxBytes: 2 * 1024 * 1024, maxSide: 1600 } as const;

export type ImageInfo = { mime: "image/png" | "image/jpeg" | "image/webp"; ext: "png" | "jpg" | "webp"; width: number; height: number };
export type ImageCheck = { ok: true; info: ImageInfo } | { ok: false; code: string; message: string };

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) => (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

/** Size of a PNG from its IHDR chunk. */
function png(b: Uint8Array): [number, number] | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v) || ascii(b, 12, 4) !== "IHDR") return null;
  return [u32be(b, 16), u32be(b, 20)];
}

/** Size of a JPEG from its first start-of-frame marker. */
function jpeg(b: Uint8Array): [number, number] | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) return [u16be(b, i + 7), u16be(b, i + 5)];
    i += 2 + length;
  }
  return null;
}

/** Size of a WebP (lossy VP8, lossless VP8L or extended VP8X). */
function webp(b: Uint8Array): [number, number] | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const b0 = b[21] ?? 0;
    const b1 = b[22] ?? 0;
    const b2 = b[23] ?? 0;
    const b3 = b[24] ?? 0;
    return [1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))];
  }
  if (chunk === "VP8X") return [1 + u24le(b, 24), 1 + u24le(b, 27)];
  return null;
}

export function checkSurveyImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, code: "empty", message: "Die Datei ist leer." };
  if (bytes.length > SURVEY_IMAGE_LIMITS.maxBytes) return { ok: false, code: "too_large", message: "Das Bild ist grösser als 2 MB." };
  const candidates: [ImageInfo["mime"], ImageInfo["ext"], [number, number] | null][] = [
    ["image/png", "png", png(bytes)],
    ["image/jpeg", "jpg", jpeg(bytes)],
    ["image/webp", "webp", webp(bytes)],
  ];
  const found = candidates.find(([, , size]) => size !== null);
  if (found === undefined || found[2] === null) {
    return { ok: false, code: "invalid_type", message: "Nur PNG, JPEG oder WebP sind erlaubt (kein SVG)." };
  }
  const [mime, ext, [width, height]] = found;
  if (width < 1 || height < 1) return { ok: false, code: "invalid_image", message: "Das Bild hat keine gültige Grösse." };
  if (width > SURVEY_IMAGE_LIMITS.maxSide || height > SURVEY_IMAGE_LIMITS.maxSide) {
    return { ok: false, code: "too_many_pixels", message: "Das Bild ist grösser als 1600 Pixel (bitte verkleinern)." };
  }
  return { ok: true, info: { mime, ext, width, height } };
}

/** Base64 to bytes; null when it isn't base64 or decodes to more than the limit. */
export function decodeBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil((SURVEY_IMAGE_LIMITS.maxBytes * 4) / 3) + 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The alt text as stored: trimmed, 1 to 140 characters, else null. */
export function cleanAltText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return [...text].length >= 1 && [...text].length <= 140 ? text : null;
}
