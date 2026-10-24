// Pure: attachments of e-mail notices (no Deno APIs, unit tested in
// src/lib/__tests__/adminMail.test.ts). The type is decided by the file's first bytes, never by
// its name or the type the browser claimed; the name the recipient sees is rebuilt from it.

export type AttachmentKind = { ext: "pdf" | "png" | "jpg" | "txt"; type: string };

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
// Starts of executables and archives that must never pass as text: MZ (Windows), ELF, #! (scripts),
// PK (zip, also office files and apps).
const NOT_TEXT = [[0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x23, 0x21], [0x50, 0x4b]];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

/** pdf, png, jpg or plain UTF-8 text; null for everything else. */
export function detectFileType(bytes: Uint8Array): AttachmentKind | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, PDF)) return { ext: "pdf", type: "application/pdf" };
  if (startsWith(bytes, PNG)) return { ext: "png", type: "image/png" };
  if (startsWith(bytes, JPG)) return { ext: "jpg", type: "image/jpeg" };
  if (NOT_TEXT.some((prefix) => startsWith(bytes, prefix))) return null;
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return { ext: "txt", type: "text/plain" };
}

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

/**
 * A safe file name: no folders, only letters, digits, "-" and "_", no second extension
 * ("rechnung.pdf.exe" becomes "rechnung_pdf.txt" if it is text), the extension of the detected type.
 */
export function sanitizeFilename(name: string, ext: AttachmentKind["ext"]): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const withoutExt = last.includes(".") ? last.slice(0, last.lastIndexOf(".")) : last;
  const base = withoutExt
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? "_")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 80);
  return `${base !== "" ? base : "anhang"}.${ext}`;
}

/** Extension the dashboard accepts before uploading (the server checks the bytes again). */
export function extensionAllowed(name: string): boolean {
  return /\.(pdf|png|jpe?g|txt)$/i.test(name);
}

/** Storage path of an attachment: {owner}/{draft uuid}/{safe name}. */
export function attachmentPathAllowed(path: unknown, owner: string): path is string {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    parts[0] === owner &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1] ?? "") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(parts[2] ?? "")
  );
}

/** Base64 for the mail provider, in chunks (large files would overflow String.fromCharCode). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
