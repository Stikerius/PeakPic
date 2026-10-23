import { describe, expect, it } from "@jest/globals";

import { dropIndex, moveLabel, moveTo } from "@/lib/sortable";

// Rows of different heights: 0-50, 50-150, 150-180, 180-280.
const rects = [
  { y: 0, height: 50 },
  { y: 50, height: 100 },
  { y: 150, height: 30 },
  { y: 180, height: 100 },
];

describe("dropIndex", () => {
  it("stays in place for small movements", () => {
    expect(dropIndex(rects, 1, 0)).toBe(1);
    expect(dropIndex(rects, 1, 20)).toBe(1);
  });

  it("moves down past the centres of the rows below", () => {
    // Centre of row 1 is 100; past row 2 (165) at +70, past row 3 (230) at +140.
    expect(dropIndex(rects, 1, 70)).toBe(2);
    expect(dropIndex(rects, 1, 140)).toBe(3);
    expect(dropIndex(rects, 1, 1000)).toBe(3);
  });

  it("moves up past the centres of the rows above", () => {
    expect(dropIndex(rects, 3, -70)).toBe(2);
    expect(dropIndex(rects, 3, -210)).toBe(0);
  });

  it("keeps an unknown row where it is", () => {
    expect(dropIndex(rects, 9, 100)).toBe(9);
  });
});

describe("moveTo", () => {
  it("moves an item and clamps the target", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveTo(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("moveLabel", () => {
  it("names the item, its position and the direction", () => {
    expect(moveLabel("Pull", 1, 4, "up")).toBe("Pull, Position 2 von 4, nach oben verschieben");
    expect(moveLabel("Kniebeuge", 0, 3, "down")).toBe("Kniebeuge, Position 1 von 3, nach unten verschieben");
  });
});
