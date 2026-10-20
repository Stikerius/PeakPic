import { describe, expect, it } from "@jest/globals";

import { fromPhotoEdits, parsePhotoEdits, sameEdits, toPhotoEdits, type MediaOverlay } from "@/lib/photoEdits";

const phone = { width: 390, height: 487.5 };
const bigPhone = { width: 430, height: 537.5 };
let counter = 0;
const createId = () => `id-${counter++}`;

const items: MediaOverlay[] = [
  { id: "a", kind: "text", text: "Leg Day", color: "#FFFFFF", background: true, x: 195, y: 100 },
  { id: "b", kind: "mention", user: { id: "u1", username: "lena", avatarUrl: "https://x" }, x: 39, y: 487.5 },
];

describe("photo edits", () => {
  it("is null for an untouched photo", () => {
    expect(toPhotoEdits(0, [], phone)).toBeNull();
  });

  it("stores positions relative to the canvas and restores them on another size", () => {
    const edits = toPhotoEdits(2, items, phone);
    expect(edits?.items[0]).toMatchObject({ x: 0.5, y: 0.2051 });
    const restored = fromPhotoEdits(edits, bigPhone, createId);
    expect(restored.filterIndex).toBe(2);
    expect(restored.items[1]).toMatchObject({ kind: "mention", x: 43, y: 537.5 });
  });

  it("survives a round trip unchanged", () => {
    const edits = toPhotoEdits(1, items, phone);
    const restored = fromPhotoEdits(edits, phone, createId);
    expect(sameEdits(toPhotoEdits(restored.filterIndex, restored.items, phone), edits)).toBe(true);
  });

  it("parses stored JSON and drops unknown entries", () => {
    const parsed = parsePhotoEdits({
      filterIndex: 3,
      items: [{ kind: "text", text: "Hi", color: "#000000", background: false, x: 0.1, y: 0.2 }, { kind: "sticker" }],
    });
    expect(parsed?.items).toHaveLength(1);
    expect(parsePhotoEdits(null)).toBeNull();
    expect(parsePhotoEdits({ filterIndex: "x", items: [] })).toBeNull();
  });
});
