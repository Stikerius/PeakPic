import { describe, expect, it } from "@jest/globals";

import {
  IDENTITY,
  STORY_FILTERS,
  brightness,
  compose,
  contrast,
  saturation,
  type ColorMatrix,
} from "@/lib/storyFilters";

/** Applies a 4x5 matrix to an RGBA colour (0..1). */
function apply(m: ColorMatrix, [r, g, b, a]: [number, number, number, number]): number[] {
  return [0, 1, 2, 3].map(
    (row) =>
      (m[row * 5] ?? 0) * r +
      (m[row * 5 + 1] ?? 0) * g +
      (m[row * 5 + 2] ?? 0) * b +
      (m[row * 5 + 3] ?? 0) * a +
      (m[row * 5 + 4] ?? 0),
  );
}

describe("color matrices", () => {
  it("composes with identity without changing anything", () => {
    const m = contrast(1.3);
    expect(compose(IDENTITY, m)).toEqual(m);
    expect(compose(m, IDENTITY)).toEqual(m);
  });

  it("applies the second matrix after the first", () => {
    const combined = compose(brightness(0.1), contrast(2));
    const color: [number, number, number, number] = [0.4, 0.4, 0.4, 1];
    const stepwise = apply(contrast(2), apply(brightness(0.1), color) as [number, number, number, number]);
    apply(combined, color).forEach((value, i) => expect(value).toBeCloseTo(stepwise[i] ?? NaN));
  });

  it("saturation 0 turns colours grey", () => {
    const [r, g, b] = apply(saturation(0), [1, 0, 0, 1]);
    expect(r).toBeCloseTo(g ?? NaN);
    expect(g).toBeCloseTo(b ?? NaN);
  });

  it("keeps alpha untouched in every filter", () => {
    for (const filter of STORY_FILTERS) {
      expect(filter.matrix).toHaveLength(20);
      expect(apply(filter.matrix, [0.3, 0.5, 0.7, 0.8])[3]).toBeCloseTo(0.8);
    }
  });
});
