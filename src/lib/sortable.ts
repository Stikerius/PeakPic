/** Reordering lists by dragging, the pure part (unit tested). */

/** Where a row sits in its list (from onLayout), in list order. */
export type RowRect = { y: number; height: number };

/**
 * The index a dragged row lands on: by where its centre ends up after moving `dy` pixels,
 * counting the other rows whose centre is above it. Works with rows of different heights.
 */
export function dropIndex(rects: readonly RowRect[], from: number, dy: number): number {
  const dragged = rects[from];
  if (dragged === undefined) return from;
  const center = dragged.y + dragged.height / 2 + dy;
  let index = 0;
  rects.forEach((rect, i) => {
    if (i !== from && rect.y + rect.height / 2 < center) index += 1;
  });
  return index;
}

/** The list with the item at `from` moved to `to` (both clamped to the list). */
export function moveTo<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.min(Math.max(to, 0), items.length - 1);
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

/** "Push, Position 2 von 4, nach oben verschieben" (the arrow buttons for VoiceOver). */
export function moveLabel(name: string, index: number, total: number, direction: "up" | "down"): string {
  return `${name}, Position ${index + 1} von ${total}, nach ${direction === "up" ? "oben" : "unten"} verschieben`;
}
