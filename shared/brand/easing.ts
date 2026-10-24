// Pure easing helpers. Marked as worklets so the app can run them on the UI thread (Reanimated);
// elsewhere the directive is just an unused string.

/** Clamps to 0..1. */
export function clamp01(value: number): number {
  "worklet";
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Position of `value` between `start` and `end` as 0..1 (clamped). */
export function segment(value: number, start: number, end: number): number {
  "worklet";
  if (end <= start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

function bezierCoordinate(s: number, p1: number, p2: number): number {
  "worklet";
  const inv = 1 - s;
  return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
}

/** CSS cubic-bezier(x1, y1, x2, y2) at time t (0..1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  "worklet";
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  // Bisection on x(s) = t: exact enough (1e-6) and without the edge cases of Newton's method.
  let low = 0;
  let high = 1;
  let s = x;
  for (let i = 0; i < 30; i += 1) {
    const current = bezierCoordinate(s, x1, x2);
    if (Math.abs(current - x) < 1e-7) break;
    if (current < x) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return bezierCoordinate(s, y1, y2);
}

export type CurveName = "draw" | "fill" | "wave" | "inOut";
export type EasingName = "smooth" | "snappy" | "linear";

/** Control points per easing style; "smooth" is the approved standard timing. */
export const CURVES: Record<Exclude<EasingName, "linear">, Record<CurveName, readonly [number, number, number, number]>> = {
  smooth: {
    draw: [0.45, 0, 0.2, 1],
    fill: [0, 0, 0.58, 1], // CSS ease-out
    wave: [0.2, 0.6, 0.3, 1],
    inOut: [0.42, 0, 0.58, 1], // CSS ease-in-out
  },
  snappy: {
    draw: [0.7, 0, 0.1, 1],
    fill: [0.16, 1, 0.3, 1],
    wave: [0.1, 0.9, 0.2, 1],
    inOut: [0.65, 0, 0.35, 1],
  },
};

export function ease(style: EasingName, curve: CurveName, t: number): number {
  "worklet";
  if (style === "linear") return clamp01(t);
  const c = CURVES[style][curve];
  return cubicBezier(c[0], c[1], c[2], c[3], t);
}
