import { describe, expect, it } from "@jest/globals";

import { coverPoint, mentionTapBox } from "@/lib/overlayGeometry";

describe("coverPoint", () => {
  it("maps directly when the aspect ratios match", () => {
    expect(coverPoint({ x: 0.5, y: 0.25 }, 0.8, { width: 400, height: 500 })).toEqual({ x: 200, y: 125 });
  });

  it("accounts for the cropped side of a taller view", () => {
    // Image 9:16 shown in a 9:19.5 screen: the sides are cropped.
    const point = coverPoint({ x: 0, y: 0.5 }, 9 / 16, { width: 390, height: 845 });
    expect(point.y).toBeCloseTo(422.5);
    expect(point.x).toBeLessThan(0);
  });
});

describe("mentionTapBox", () => {
  it("is centred on the label and grows with the name", () => {
    const short = mentionTapBox({ x: 200, y: 100 }, "mia", 400);
    const long = mentionTapBox({ x: 200, y: 100 }, "sara.squats", 400);
    expect(short.left + short.width / 2).toBe(200);
    expect(long.width).toBeGreaterThan(short.width);
  });
});
