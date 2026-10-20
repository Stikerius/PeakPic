import type { PublicProfile } from "@/types/social";

/** A text or @mention placed on a photo, in canvas coordinates (px). */
export type MediaOverlay =
  | { id: string; kind: "text"; text: string; color: string; background: boolean; x: number; y: number }
  | { id: string; kind: "mention"; user: PublicProfile; x: number; y: number };

type StoredOverlay =
  | { kind: "text"; text: string; color: string; background: boolean; x: number; y: number }
  | { kind: "mention"; user: { id: string; username: string }; x: number; y: number };

/**
 * Edits of one photo as stored with it (post_media.edits), so it can be edited again from
 * the original. Positions are fractions of the canvas (0–1): canvases differ per device.
 */
export type PhotoEdits = { filterIndex: number; items: StoredOverlay[] };

export type CanvasSize = { width: number; height: number };

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Null when the photo has no edits at all. */
export function toPhotoEdits(filterIndex: number, items: MediaOverlay[], size: CanvasSize): PhotoEdits | null {
  if (filterIndex === 0 && items.length === 0) return null;
  return {
    filterIndex,
    items: items.map((item) => {
      const x = round(item.x / size.width);
      const y = round(item.y / size.height);
      return item.kind === "text"
        ? { kind: "text", text: item.text, color: item.color, background: item.background, x, y }
        : { kind: "mention", user: { id: item.user.id, username: item.user.username }, x, y };
    }),
  };
}

export function fromPhotoEdits(
  edits: PhotoEdits | null,
  size: CanvasSize,
  createId: () => string,
): { filterIndex: number; items: MediaOverlay[] } {
  if (edits === null) return { filterIndex: 0, items: [] };
  return {
    filterIndex: edits.filterIndex,
    items: edits.items.map((item): MediaOverlay => {
      const x = item.x * size.width;
      const y = item.y * size.height;
      return item.kind === "text"
        ? { id: createId(), kind: "text", text: item.text, color: item.color, background: item.background, x, y }
        : { id: createId(), kind: "mention", user: { ...item.user, avatarUrl: null }, x, y };
    }),
  };
}

/** Same edits? (Compares the stored form, so tiny float differences don't count.) */
export function sameEdits(a: PhotoEdits | null, b: PhotoEdits | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverlay(value: unknown): StoredOverlay | null {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") return null;
  if (
    value.kind === "text" &&
    typeof value.text === "string" &&
    typeof value.color === "string" &&
    typeof value.background === "boolean"
  ) {
    return { kind: "text", text: value.text, color: value.color, background: value.background, x: value.x, y: value.y };
  }
  const user = value.user;
  if (value.kind === "mention" && isRecord(user) && typeof user.id === "string" && typeof user.username === "string") {
    return { kind: "mention", user: { id: user.id, username: user.username }, x: value.x, y: value.y };
  }
  return null;
}

/** Validates edits read from the database (jsonb); anything unexpected is dropped. */
export function parsePhotoEdits(value: unknown): PhotoEdits | null {
  if (!isRecord(value) || typeof value.filterIndex !== "number" || !Array.isArray(value.items)) return null;
  return {
    filterIndex: value.filterIndex,
    items: value.items.flatMap((item) => {
      const parsed = parseOverlay(item);
      return parsed !== null ? [parsed] : [];
    }),
  };
}
