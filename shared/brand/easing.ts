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

// ------------------------------------------------------------------ easing v2 (animation editor)
// Every segment between two keyframes has one of these. Fixed kinds with numbers in fixed ranges,
// never code or expressions; the database checks the same ranges.

export const EASING_PRESETS = ["linear", "smooth", "snappy", "easeIn", "easeOut", "easeInOut", "easeInStrong", "easeOutStrong", "easeInOutStrong"] as const;
export type EasingPreset = (typeof EASING_PRESETS)[number];

/** Control points of the named curves (CSS and the common "cubic" variants). */
export const EASING_PRESET_CURVES: Record<Exclude<EasingPreset, "linear">, readonly [number, number, number, number]> = {
  smooth: [0.25, 0.1, 0.25, 1],
  snappy: [0.16, 1, 0.3, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeInStrong: [0.55, 0.055, 0.675, 0.19],
  easeOutStrong: [0.215, 0.61, 0.355, 1],
  easeInOutStrong: [0.645, 0.045, 0.355, 1],
};

export type EasingSpec =
  | { type: "preset"; name: EasingPreset; reverse?: boolean }
  | { type: "bezier"; x1: number; y1: number; x2: number; y2: number; reverse?: boolean }
  /** Damped oscillation that settles on the target; damping 0.2 (springy) .. 1 (calm), frequency in swings per segment. */
  | { type: "spring"; damping: number; frequency: number; reverse?: boolean }
  /** Lands, bounces `bounces` times, each bounce `damping` times as high as the previous one. */
  | { type: "bounce"; bounces: number; damping: number; reverse?: boolean }
  /** Keeps the start value and jumps at the end of the segment. */
  | { type: "hold"; reverse?: boolean };

export const EASING_LIMITS = {
  bezierX: [0, 1],
  bezierY: [-1, 2],
  springDamping: [0.2, 1],
  springFrequency: [1, 6],
  bounceCount: [1, 4],
  bounceDamping: [0.2, 0.8],
} as const;

export const LINEAR: EasingSpec = { type: "preset", name: "linear" };

/** Spring: 1 - e^(-d·k·t)·cos(2π·f·t), corrected linearly so it ends exactly on 1. */
export function springEase(damping: number, frequency: number, t: number): number {
  "worklet";
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  const k = 8 * damping;
  const w = 2 * Math.PI * frequency;
  const raw = (s: number) => 1 - Math.exp(-k * s) * Math.cos(w * s);
  return raw(x) + (1 - raw(1)) * x;
}

/**
 * Bounce: a fall to 1 that takes the first half of the time, then `bounces` arcs back up, each
 * `damping` times as high (heights as a share of the fall) and correspondingly shorter.
 */
export function bounceEase(bounces: number, damping: number, t: number): number {
  "worklet";
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  const n = Math.max(1, Math.min(4, Math.round(bounces)));
  // Durations: the fall takes 1 unit, an arc of height h takes 2·sqrt(h) units.
  let total = 1;
  let height = 1;
  for (let i = 0; i < n; i += 1) {
    height *= damping;
    total += 2 * Math.sqrt(height);
  }
  const u = x * total;
  if (u <= 1) return u * u;
  let start = 1;
  height = 1;
  for (let i = 0; i < n; i += 1) {
    height *= damping;
    const half = Math.sqrt(height);
    if (u <= start + 2 * half) {
      const d = u - start - half;
      return 1 - height + d * d;
    }
    start += 2 * half;
  }
  return 1;
}

/** The curve of an easing at s (0..1), without `reverse`. */
export function easingCurve(spec: EasingSpec, s: number): number {
  "worklet";
  switch (spec.type) {
    case "preset": {
      if (spec.name === "linear") return clamp01(s);
      const c = EASING_PRESET_CURVES[spec.name];
      return cubicBezier(c[0], c[1], c[2], c[3], s);
    }
    case "bezier":
      return cubicBezier(spec.x1, spec.y1, spec.x2, spec.y2, s);
    case "spring":
      return springEase(spec.damping, spec.frequency, s);
    case "bounce":
      return bounceEase(spec.bounces, spec.damping, s);
    case "hold":
      return s >= 1 ? 1 : 0;
  }
}

/**
 * Value between two keyframes a (at s = 0) and b (at s = 1). With `reverse` the curve runs
 * backwards from b (mirrored in time): b + (a - b)·curve(1 - s).
 */
export function interpolate(a: number, b: number, spec: EasingSpec, s: number): number {
  "worklet";
  if (spec.reverse === true) return b + (a - b) * easingCurve(spec, 1 - s);
  return a + (b - a) * easingCurve(spec, s);
}

/** The eased share 0..1 (for previews of the curve). */
export function applyEasing(spec: EasingSpec, s: number): number {
  "worklet";
  return interpolate(0, 1, spec, s);
}
