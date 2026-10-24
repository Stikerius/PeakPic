import { describe, expect, it } from "@jest/globals";

import {
  EASING_PRESETS,
  applyEasing,
  bounceEase,
  cubicBezier,
  easingCurve,
  interpolate,
  springEase,
  type EasingSpec,
} from "../../../shared/brand/easing";

const steps = Array.from({ length: 201 }, (_, i) => i / 200);

describe("easing v2", () => {
  const all: EasingSpec[] = [
    ...EASING_PRESETS.map((name): EasingSpec => ({ type: "preset", name })),
    { type: "bezier", x1: 0.3, y1: -0.5, x2: 0.7, y2: 1.6 },
    { type: "spring", damping: 0.2, frequency: 6 },
    { type: "spring", damping: 1, frequency: 1 },
    { type: "bounce", bounces: 1, damping: 0.2 },
    { type: "bounce", bounces: 4, damping: 0.8 },
    { type: "hold" },
  ];

  it("every easing starts at 0 and ends at 1, also reversed", () => {
    for (const spec of all) {
      expect(applyEasing(spec, 0)).toBe(0);
      expect(applyEasing(spec, 1)).toBe(1);
      expect(applyEasing({ ...spec, reverse: true }, 0)).toBeCloseTo(0, 12);
      expect(applyEasing({ ...spec, reverse: true }, 1)).toBeCloseTo(1, 12);
      for (const s of steps) expect(Number.isFinite(applyEasing(spec, s))).toBe(true);
    }
  });

  it("the named curves and curves with y in 0..1 never go back", () => {
    const monotone: EasingSpec[] = [...EASING_PRESETS.map((name): EasingSpec => ({ type: "preset", name })), { type: "bezier", x1: 0.9, y1: 0, x2: 0.1, y2: 1 }];
    for (const spec of monotone) {
      let last = -Infinity;
      for (const s of steps) {
        const v = applyEasing(spec, s);
        expect(v).toBeGreaterThanOrEqual(last - 1e-7);
        expect(v).toBeGreaterThanOrEqual(-1e-7);
        expect(v).toBeLessThanOrEqual(1 + 1e-7);
        last = v;
      }
    }
  });

  it("bezier matches CSS: ease-in-out is symmetric, linear control points are linear", () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(cubicBezier(0, 0, 1, 1, 0.3)).toBeCloseTo(0.3, 6);
  });

  it("spring overshoots and settles, softer with more damping", () => {
    const springy = steps.map((s) => springEase(0.2, 3, s));
    expect(Math.max(...springy)).toBeGreaterThan(1);
    const calm = steps.map((s) => springEase(1, 1, s));
    expect(Math.max(...calm) - 1).toBeLessThan(Math.max(...springy) - 1);
  });

  it("bounce touches 1 between its bounces and never goes above", () => {
    const values = steps.map((s) => bounceEase(3, 0.5, s));
    expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-12);
    expect(values.filter((v, i) => i > 0 && Math.abs(v - 1) < 0.02).length).toBeGreaterThan(2);
  });

  it("hold keeps the start until the end", () => {
    expect(easingCurve({ type: "hold" }, 0.999)).toBe(0);
    expect(easingCurve({ type: "hold" }, 1)).toBe(1);
  });

  it("reverse mirrors the segment in time", () => {
    const spec: EasingSpec = { type: "preset", name: "easeIn" };
    for (const s of steps) expect(interpolate(0, 1, { ...spec, reverse: true }, s)).toBeCloseTo(1 - applyEasing(spec, 1 - s), 12);
  });
});
