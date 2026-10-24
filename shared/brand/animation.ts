// "Animation v2": a timeline with tracks. Pure data (fixed track kinds, numbers in fixed ranges, no
// code, no expressions, no free strings) and one pure evaluation that the app (UI thread,
// Reanimated worklets) and the dashboard share. The database checks the same rules in
// public.brand_animation_problem() (supabase/schema.sql).
//
// A track has a kind, a target (all shapes, one shape, shapes of a role), keyframes (time 0..1,
// value, easing of the segment that starts there), a stagger (later start per shape) and a repeat
// count within the loop. Tracks for all shapes without stagger act on whole layers (logo, fill,
// outline); the others act on single shapes in addition.

import {
  CURVES,
  EASING_LIMITS,
  EASING_PRESETS,
  LINEAR,
  clamp01,
  interpolate,
  segment,
  type EasingPreset,
  type EasingSpec,
} from "./easing";
import { LOGO_LIMITS, shapesBounds, type LogoSpec, type ShapeRole } from "./logoSpec";
import { brandTimeline } from "./timeline";
import { STANDARD_PARAMS, validatePresetParams, type PresetParams } from "./presets";

export const ANIMATION_VERSION = 2;

export const TRACK_KINDS = ["draw", "fill", "shine", "wave", "dots", "sparks", "breathe", "rotate", "float", "exit", "color"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** Kinds that act on the whole stage; their target is always "all", without stagger. */
export const GLOBAL_KINDS: readonly TrackKind[] = ["shine", "wave", "dots", "sparks"];

export const TRACK_LABELS: Record<TrackKind, string> = {
  draw: "Linie zeichnen",
  fill: "Füllen",
  shine: "Glanz",
  wave: "Welle",
  dots: "Punktraster",
  sparks: "Funken",
  breathe: "Atmen",
  rotate: "Drehen",
  float: "Schweben",
  exit: "Ausblenden",
  color: "Farbwechsel",
};

/** What the keyframe value means, per kind, with its range. */
export const VALUE_RANGES: Record<TrackKind, readonly [number, number]> = {
  draw: [0, 1],
  fill: [0, 1],
  shine: [0, 1],
  wave: [0, 1],
  dots: [0, 1],
  sparks: [0, 1],
  breathe: [-0.1, 0.1],
  rotate: [-360, 360],
  float: [-30, 30],
  exit: [0, 1],
  color: [0, 1],
};

export const VALUE_LABELS: Record<TrackKind, string> = {
  draw: "Gezeichnet (0 bis 1)",
  fill: "Gefüllt (0 bis 1)",
  shine: "Position (0 links bis 1 rechts)",
  wave: "Deckkraft",
  dots: "Leuchten",
  sparks: "Flug (0 bis 1)",
  breathe: "Grösse (-0,1 bis 0,1 = ±10 %)",
  rotate: "Winkel (Grad)",
  float: "Verschiebung (Einheiten)",
  exit: "Ausgeblendet (0 bis 1)",
  color: "Mischung (0 bis 1)",
};

export const FILL_VARIANTS = ["fade", "bloom", "wipeUp", "wipeDown", "wipeLeft", "wipeRight"] as const;
export type FillVariant = (typeof FILL_VARIANTS)[number];
export const FILL_VARIANT_LABELS: Record<FillVariant, string> = {
  fade: "Einblenden",
  bloom: "Aufblühen",
  wipeUp: "Wischen von unten",
  wipeDown: "Wischen von oben",
  wipeLeft: "Wischen von links",
  wipeRight: "Wischen von rechts",
};
export const DOTS_VARIANTS = ["glow", "gradient"] as const;
export const EXIT_VARIANTS = ["fade", "shrink"] as const;
export const EXIT_LAYERS = ["all", "outline", "fill"] as const;
export const FLOAT_AXES = ["x", "y"] as const;
export const COLOR_NAMES = ["accent", "accentLight", "accentDark", "neutral"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
export const COLOR_NAME_LABELS: Record<ColorName, string> = {
  accent: "Akzent",
  accentLight: "Akzent hell",
  accentDark: "Akzent dunkel",
  neutral: "Neutral",
};
export const STAGGER_MODES = ["none", "order", "center", "random"] as const;
export type StaggerMode = (typeof STAGGER_MODES)[number];
export const STAGGER_LABELS: Record<StaggerMode, string> = {
  none: "Keine",
  order: "In Reihenfolge",
  center: "Von der Mitte",
  random: "Zufällig (Seed)",
};

export const ANIMATION_LIMITS = {
  duration: [2, 30],
  strokeWidth: [1, 6],
  tracks: 16,
  keyframes: 12,
  staggerAmount: [0, 0.5],
  seed: [0, 999999],
  repeat: [1, 4],
  sparksTotal: 40,
  /** Shapes beyond this are not animated one by one (they follow the whole logo). */
  animatedShapes: 24,
  /** Largest stored spec (characters of its JSON). */
  chars: 60000,
} as const;

/** Numbers of the track kinds (ranges) and their choices. */
export const KIND_NUMBERS = {
  draw: {},
  fill: {},
  shine: { width: [20, 120], angle: [-30, 30], strength: [0.1, 0.8] },
  wave: { scale: [3, 8] },
  dots: { spacing: [12, 28], radius: [0.8, 2.2], glowRadius: [1.2, 2.6], fade: [0.2, 0.8] },
  sparks: { count: [1, 40], seed: [0, 999999], size: [0.5, 3], distance: [0.2, 1.5] },
  breathe: {},
  rotate: {},
  float: {},
  exit: { amount: [0.1, 1] },
  color: {},
} as const satisfies Record<TrackKind, Record<string, readonly [number, number]>>;
/** Kind numbers that must be whole numbers. */
export const KIND_INTEGERS: readonly string[] = ["count", "seed"];
export const KIND_CHOICES = {
  draw: {},
  fill: { variant: FILL_VARIANTS },
  shine: {},
  wave: {},
  dots: { variant: DOTS_VARIANTS },
  sparks: {},
  breathe: {},
  rotate: {},
  float: { axis: FLOAT_AXES },
  exit: { variant: EXIT_VARIANTS, layer: EXIT_LAYERS },
  color: { from: COLOR_NAMES, to: COLOR_NAMES },
} as const satisfies Record<TrackKind, Record<string, readonly string[]>>;

export type Keyframe = { t: number; v: number; ease: EasingSpec };
export type Target = { type: "all" } | { type: "shape"; index: number } | { type: "role"; role: ShapeRole };
export type Stagger = { mode: StaggerMode; amount: number; seed: number };

type TrackBase = { enabled: boolean; target: Target; keyframes: Keyframe[]; stagger: Stagger; repeat: number };
export type Track =
  | (TrackBase & { kind: "draw" })
  | (TrackBase & { kind: "fill"; variant: FillVariant })
  | (TrackBase & { kind: "shine"; width: number; angle: number; strength: number })
  | (TrackBase & { kind: "wave"; scale: number; grow: EasingSpec })
  | (TrackBase & { kind: "dots"; variant: "glow" | "gradient"; spacing: number; radius: number; glowRadius: number; fade: number })
  | (TrackBase & { kind: "sparks"; count: number; seed: number; size: number; distance: number })
  | (TrackBase & { kind: "breathe" })
  | (TrackBase & { kind: "rotate" })
  | (TrackBase & { kind: "float"; axis: "x" | "y" })
  | (TrackBase & { kind: "exit"; variant: "fade" | "shrink"; layer: "all" | "outline" | "fill"; amount: number })
  | (TrackBase & { kind: "color"; from: ColorName; to: ColorName });

export type AnimationSpec = {
  version: 2;
  /** Seconds per loop. */
  duration: number;
  /** Line width of outlines and line shapes (logo box = 120 units). */
  strokeWidth: number;
  tracks: Track[];
};

// ------------------------------------------------------------------ check

export type AnimationCheck = { ok: true; spec: AnimationSpec } | { ok: false; error: string };

const COMMON_KEYS = ["kind", "enabled", "target", "keyframes", "stagger", "repeat"];
const EASING_KEYS: Record<EasingSpec["type"], readonly string[]> = {
  preset: ["type", "name", "reverse"],
  bezier: ["type", "x1", "y1", "x2", "y2", "reverse"],
  spring: ["type", "damping", "frequency", "reverse"],
  bounce: ["type", "bounces", "damping", "reverse"],
  hold: ["type", "reverse"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberIn(value: unknown, [min, max]: readonly [number, number]): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((k) => allowed.includes(k));
}

/** A checked copy of an easing, or null. */
export function checkEasing(value: unknown): EasingSpec | null {
  if (!isRecord(value) || typeof value.type !== "string" || !Object.prototype.hasOwnProperty.call(EASING_KEYS, value.type)) return null;
  const type = value.type as EasingSpec["type"];
  if (!onlyKeys(value, EASING_KEYS[type])) return null;
  if (value.reverse !== undefined && typeof value.reverse !== "boolean") return null;
  const reverse = value.reverse === true ? { reverse: true } : {};
  switch (type) {
    case "preset":
      if (typeof value.name !== "string" || !(EASING_PRESETS as readonly string[]).includes(value.name)) return null;
      return { type, name: value.name as EasingPreset, ...reverse };
    case "bezier": {
      const { x1, y1, x2, y2 } = value;
      if (!numberIn(x1, EASING_LIMITS.bezierX) || !numberIn(x2, EASING_LIMITS.bezierX)) return null;
      if (!numberIn(y1, EASING_LIMITS.bezierY) || !numberIn(y2, EASING_LIMITS.bezierY)) return null;
      return { type, x1, y1, x2, y2, ...reverse };
    }
    case "spring":
      if (!numberIn(value.damping, EASING_LIMITS.springDamping) || !numberIn(value.frequency, EASING_LIMITS.springFrequency)) return null;
      return { type, damping: value.damping, frequency: value.frequency, ...reverse };
    case "bounce":
      if (!numberIn(value.bounces, EASING_LIMITS.bounceCount) || !Number.isInteger(value.bounces)) return null;
      if (!numberIn(value.damping, EASING_LIMITS.bounceDamping)) return null;
      return { type, bounces: value.bounces, damping: value.damping, ...reverse };
    case "hold":
      return { type, ...reverse };
  }
}

function checkTarget(value: unknown): Target | null {
  if (!isRecord(value)) return null;
  if (value.type === "all" && onlyKeys(value, ["type"])) return { type: "all" };
  if (value.type === "shape" && onlyKeys(value, ["type", "index"])) {
    const index = value.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= LOGO_LIMITS.maxShapes) return null;
    return { type: "shape", index };
  }
  if (value.type === "role" && onlyKeys(value, ["type", "role"])) {
    if (value.role !== "fill" && value.role !== "cutout" && value.role !== "stroke") return null;
    return { type: "role", role: value.role };
  }
  return null;
}

function checkTrack(value: unknown, index: number): Track | string {
  const where = `Spur ${index + 1}`;
  if (!isRecord(value)) return `${where}: kein Objekt.`;
  const kind = value.kind;
  if (typeof kind !== "string" || !(TRACK_KINDS as readonly string[]).includes(kind)) return `${where}: unbekannte Art.`;
  const k = kind as TrackKind;
  const numbers: Record<string, readonly [number, number]> = KIND_NUMBERS[k];
  const choices: Record<string, readonly string[]> = KIND_CHOICES[k];
  const extra = k === "wave" ? ["grow"] : [];
  const allowed = [...COMMON_KEYS, ...Object.keys(numbers), ...Object.keys(choices), ...extra];
  if (!onlyKeys(value, allowed)) return `${where}: unbekanntes Feld.`;
  if (typeof value.enabled !== "boolean") return `${where}: „aktiv“ fehlt.`;
  const target = checkTarget(value.target);
  if (target === null) return `${where}: ungültiges Ziel.`;
  if (!isRecord(value.stagger) || !onlyKeys(value.stagger, ["mode", "amount", "seed"])) return `${where}: ungültige Staffelung.`;
  const { mode, amount, seed } = value.stagger;
  if (typeof mode !== "string" || !(STAGGER_MODES as readonly string[]).includes(mode)) return `${where}: ungültige Staffelung.`;
  if (!numberIn(amount, ANIMATION_LIMITS.staggerAmount)) return `${where}: Versatz muss zwischen 0 und 0,5 liegen.`;
  if (!numberIn(seed, ANIMATION_LIMITS.seed) || !Number.isInteger(seed)) return `${where}: Seed muss eine ganze Zahl sein.`;
  if (!numberIn(value.repeat, ANIMATION_LIMITS.repeat) || !Number.isInteger(value.repeat)) return `${where}: Wiederholung 1 bis 4.`;
  if (GLOBAL_KINDS.includes(k) && (target.type !== "all" || mode !== "none")) return `${where}: ${TRACK_LABELS[k]} wirkt immer auf alles.`;
  if (!Array.isArray(value.keyframes) || value.keyframes.length < 1 || value.keyframes.length > ANIMATION_LIMITS.keyframes) {
    return `${where}: 1 bis ${ANIMATION_LIMITS.keyframes} Keyframes.`;
  }
  const keyframes: Keyframe[] = [];
  for (const kf of value.keyframes as unknown[]) {
    if (!isRecord(kf) || !onlyKeys(kf, ["t", "v", "ease"])) return `${where}: ungültiger Keyframe.`;
    if (!numberIn(kf.t, [0, 1])) return `${where}: Zeit muss zwischen 0 und 1 liegen.`;
    const previous = keyframes[keyframes.length - 1];
    if (previous !== undefined && kf.t <= previous.t) return `${where}: Keyframes müssen zeitlich aufsteigen.`;
    if (!numberIn(kf.v, VALUE_RANGES[k])) return `${where}: Wert ausserhalb von ${VALUE_RANGES[k][0]} bis ${VALUE_RANGES[k][1]}.`;
    const ease = checkEasing(kf.ease);
    if (ease === null) return `${where}: ungültiges Easing.`;
    keyframes.push({ t: kf.t, v: kf.v, ease });
  }
  const track: Record<string, unknown> = {
    kind: k,
    enabled: value.enabled,
    target,
    keyframes,
    stagger: { mode, amount, seed },
    repeat: value.repeat,
  };
  for (const [key, range] of Object.entries(numbers)) {
    const n = value[key];
    if (!numberIn(n, range) || (KIND_INTEGERS.includes(key) && !Number.isInteger(n))) return `${where}: ${key} ausserhalb von ${range[0]} bis ${range[1]}.`;
    track[key] = n;
  }
  for (const [key, options] of Object.entries(choices)) {
    const c = value[key];
    if (typeof c !== "string" || !options.includes(c)) return `${where}: ${key} hat einen unbekannten Wert.`;
    track[key] = c;
  }
  if (k === "wave") {
    const grow = checkEasing(value.grow);
    if (grow === null) return `${where}: ungültiges Easing der Welle.`;
    track.grow = grow;
  }
  return track as Track;
}

/**
 * Exactly the known structure, every number finite and within its range, at most 16 tracks with
 * 1 to 12 keyframes each, at most one dot raster, at most 40 sparks, and the cost within the hard
 * limit. Returns a clean copy (unknown fields never pass).
 */
export function validateAnimationSpec(value: unknown): AnimationCheck {
  if (!isRecord(value)) return { ok: false, error: "Kein Objekt." };
  try {
    if (JSON.stringify(value).length > ANIMATION_LIMITS.chars) return { ok: false, error: "Die Animation ist zu gross." };
  } catch {
    return { ok: false, error: "Kein gültiges JSON." };
  }
  if (!onlyKeys(value, ["version", "duration", "strokeWidth", "tracks"])) return { ok: false, error: "Unbekanntes Feld." };
  if (value.version !== ANIMATION_VERSION) return { ok: false, error: "Unbekannte Version." };
  if (!numberIn(value.duration, ANIMATION_LIMITS.duration)) return { ok: false, error: "Dauer muss zwischen 2 und 30 Sekunden liegen." };
  if (!numberIn(value.strokeWidth, ANIMATION_LIMITS.strokeWidth)) return { ok: false, error: "Linienstärke muss zwischen 1 und 6 liegen." };
  if (!Array.isArray(value.tracks) || value.tracks.length < 1 || value.tracks.length > ANIMATION_LIMITS.tracks) {
    return { ok: false, error: `1 bis ${ANIMATION_LIMITS.tracks} Spuren.` };
  }
  const tracks: Track[] = [];
  for (let i = 0; i < value.tracks.length; i += 1) {
    const track = checkTrack(value.tracks[i], i);
    if (typeof track === "string") return { ok: false, error: track };
    tracks.push(track);
  }
  if (tracks.filter((t) => t.kind === "dots").length > 1) return { ok: false, error: "Höchstens ein Punktraster." };
  const sparks = tracks.reduce((sum, t) => sum + (t.kind === "sparks" ? t.count : 0), 0);
  if (sparks > ANIMATION_LIMITS.sparksTotal) return { ok: false, error: `Höchstens ${ANIMATION_LIMITS.sparksTotal} Funken.` };
  const spec: AnimationSpec = { version: 2, duration: value.duration, strokeWidth: value.strokeWidth, tracks };
  const cost = animationCost(spec);
  if (cost > COST_LIMITS.hard) return { ok: false, error: `Zu aufwendig (Kosten ${Math.round(cost)}, höchstens ${COST_LIMITS.hard}).` };
  return { ok: true, spec };
}

// ------------------------------------------------------------------ cost

/** Soft: a warning in the editor. Hard: refused (editor and database). */
export const COST_LIMITS = { soft: 80, hard: 160 } as const;

/** Effort per animated element and kind (a measure of the work per frame on a phone). */
export const COST_WEIGHTS: Record<TrackKind, number> = {
  draw: 1,
  fill: 2,
  shine: 4,
  wave: 6,
  dots: 3,
  sparks: 1,
  breathe: 1,
  rotate: 1,
  float: 1,
  exit: 1,
  color: 2,
};

export function isUniform(track: Track): boolean {
  return track.target.type === "all" && track.stagger.mode === "none";
}

/**
 * Estimated cost: number of animated elements times the effort of the kind. Outlines are one
 * element per shape; tracks on single shapes count the shapes they reach (one, or all for a role
 * or a stagger); tracks on single shapes need one layer per shape once. `shapes` is the shape
 * count of the logo; the database assumes the most shapes that are animated one by one.
 */
export function animationCost(spec: AnimationSpec, shapes: number = ANIMATION_LIMITS.animatedShapes): number {
  const n = Math.max(1, Math.min(shapes, ANIMATION_LIMITS.animatedShapes));
  let cost = 0;
  let perShape = false;
  for (const t of spec.tracks) {
    if (!t.enabled) continue;
    let elements = 1;
    if (t.kind === "draw") elements = n;
    else if (t.kind === "sparks") elements = t.count;
    else if (!isUniform(t)) {
      perShape = true;
      elements = t.target.type === "shape" ? 1 : n;
    }
    const weight = t.kind === "dots" && t.variant === "gradient" ? 5 : COST_WEIGHTS[t.kind];
    cost += elements * weight;
  }
  return perShape ? cost + n : cost;
}

// ------------------------------------------------------------------ evaluation

/** Per shape: order (0..1), distance from the logo's centre (0..1), role, centre in viewBox units. */
export type ShapeLayout = {
  count: number;
  roles: ShapeRole[];
  order: number[];
  center: number[];
  centers: [number, number][];
};

export const EMPTY_LAYOUT: ShapeLayout = { count: 0, roles: [], order: [], center: [], centers: [] };

export function shapeLayout(logo: LogoSpec): ShapeLayout {
  const [x, y, w, h] = logo.viewBox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const centers = logo.shapes.map((shape): [number, number] => {
    const b = shapesBounds([shape]);
    return b === null ? [cx, cy] : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  });
  const distances = centers.map(([sx, sy]) => Math.hypot(sx - cx, sy - cy));
  const far = Math.max(...distances, 1e-9);
  const n = logo.shapes.length;
  return {
    count: n,
    roles: logo.shapes.map((s) => s.role),
    order: logo.shapes.map((_, i) => (n > 1 ? i / (n - 1) : 0)),
    center: distances.map((d) => d / far),
    centers,
  };
}

/** Deterministic 0..1 from a seed and an index (same on every device). */
export function seededRandom(seed: number, index: number): number {
  "worklet";
  let a = (seed * 2654435761 + index * 40503 + 1013904223) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

function matches(track: Track, layout: ShapeLayout, i: number): boolean {
  "worklet";
  const target = track.target;
  if (target.type === "all") return true;
  if (target.type === "shape") return target.index === i;
  return layout.roles[i] === target.role;
}

/** Delay of a shape's start (share of the loop) from the track's stagger. */
export function staggerDelay(stagger: Stagger, layout: ShapeLayout, i: number): number {
  "worklet";
  if (stagger.mode === "none" || i < 0) return 0;
  if (stagger.mode === "order") return stagger.amount * (layout.order[i] ?? 0);
  if (stagger.mode === "center") return stagger.amount * (layout.center[i] ?? 0);
  return stagger.amount * seededRandom(stagger.seed, i);
}

/** The track's own time (0..1) at a point of the loop: delayed by the stagger, repeated `repeat` times. */
export function trackTime(track: Track, progress: number, delay: number): number {
  "worklet";
  const p = delay === 0 ? progress : progress - delay;
  if (p <= 0) return 0;
  if (track.repeat === 1) return p >= 1 ? 1 : p;
  const x = p * track.repeat;
  if (x >= track.repeat) return 1;
  return x - Math.floor(x);
}

/** Value of the keyframes at track time q: held before the first and after the last keyframe. */
export function keyframeValue(keyframes: readonly Keyframe[], q: number): number {
  "worklet";
  const first = keyframes[0];
  if (first === undefined) return 0;
  if (q <= first.t) return first.v;
  for (let k = 0; k < keyframes.length - 1; k += 1) {
    const a = keyframes[k];
    const b = keyframes[k + 1];
    if (a !== undefined && b !== undefined && q < b.t) return interpolate(a.v, b.v, a.ease, segment(q, a.t, b.t));
  }
  return keyframes[keyframes.length - 1]?.v ?? 0;
}

/** Whether track time q lies within the keyframes (shine, waves and sparks are only visible there). */
function inSpan(keyframes: readonly Keyframe[], q: number): boolean {
  "worklet";
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  return first !== undefined && last !== undefined && q >= first.t && q <= last.t;
}

/**
 * The value of track `trackIndex` for shape `shapeIndex` (-1: the whole logo, no stagger) at
 * `progress` (0..1) of the loop.
 */
export function value(spec: AnimationSpec, shapeIndex: number, trackIndex: number, progress: number, layout: ShapeLayout = EMPTY_LAYOUT): number {
  "worklet";
  const track = spec.tracks[trackIndex];
  if (track === undefined) return 0;
  const q = trackTime(track, clamp01(progress), staggerDelay(track.stagger, layout, shapeIndex));
  return keyframeValue(track.keyframes, q);
}

/** Wave ring: start scale and line width/radius in stage units (logo box = 120 units). */
export const WAVE_START = 0.15;
export const RING_RADIUS = 60;
export const RING_WIDTH = 90;
export const SHINE_STRENGTH = 0.55;

export type ShapeFrame = {
  draw: number;
  outlineOpacity: number;
  fillOpacity: number;
  fillScale: number;
  reveal: number;
  /** 0 none, 1 up, 2 down, 3 left, 4 right. */
  wipe: number;
  opacity: number;
  scale: number;
  rotate: number;
  dx: number;
  dy: number;
  colorFrom: number;
  colorTo: number;
  colorMix: number;
};

export type AnimFrame = {
  logoOpacity: number;
  logoScale: number;
  logoRotate: number;
  logoDx: number;
  logoDy: number;
  /** Outline: 1 = nothing drawn, 0 = complete. */
  strokeOffset: number;
  strokeOpacity: number;
  strokeScale: number;
  fillOpacity: number;
  fillScale: number;
  fillReveal: number;
  fillWipe: number;
  shine: number;
  shineOpacity: number;
  waves: { scale: number; opacity: number }[];
  dotsGlow: number;
  dotsSpread: number;
  /** Per sparks track: flight 0..1, or -1 while not flying. */
  sparks: number[];
  colorFrom: number;
  colorTo: number;
  colorMix: number;
  /** Per shape (only when tracks act on single shapes); empty otherwise. */
  shapes: ShapeFrame[];
};

function wipeIndex(variant: FillVariant): number {
  "worklet";
  return variant === "wipeUp" ? 1 : variant === "wipeDown" ? 2 : variant === "wipeLeft" ? 3 : variant === "wipeRight" ? 4 : 0;
}

function colorIndex(name: ColorName): number {
  "worklet";
  return name === "accent" ? 0 : name === "accentLight" ? 1 : name === "accentDark" ? 2 : 3;
}

/** Static facts of a spec the renderers build their structure from (not per frame). */
export type AnimationFeatures = {
  hasFill: boolean;
  hasDraw: boolean;
  shine: { width: number; angle: number } | null;
  waves: number;
  dots: { variant: "glow" | "gradient"; spacing: number; radius: number; glowRadius: number; fade: number } | null;
  sparks: { count: number; seed: number; size: number; distance: number }[];
  /** Tracks act on single shapes (and the logo has few enough shapes for that). */
  perShape: boolean;
  /** Colour can change (some colour track). */
  color: boolean;
  /** Logo moves (rotate or float on the whole logo or shapes). */
  moves: boolean;
};

export function animationFeatures(spec: AnimationSpec, shapeCount: number): AnimationFeatures {
  const on = spec.tracks.filter((t) => t.enabled);
  const shineTrack = on.find((t) => t.kind === "shine");
  const dotsTrack = on.find((t) => t.kind === "dots");
  return {
    hasFill: on.some((t) => t.kind === "fill"),
    hasDraw: on.some((t) => t.kind === "draw"),
    shine: shineTrack?.kind === "shine" ? { width: shineTrack.width, angle: shineTrack.angle } : null,
    waves: on.filter((t) => t.kind === "wave").length,
    dots:
      dotsTrack?.kind === "dots"
        ? { variant: dotsTrack.variant, spacing: dotsTrack.spacing, radius: dotsTrack.radius, glowRadius: dotsTrack.glowRadius, fade: dotsTrack.fade }
        : null,
    sparks: on.flatMap((t) => (t.kind === "sparks" ? [{ count: t.count, seed: t.seed, size: t.size, distance: t.distance }] : [])),
    perShape: shapeCount <= ANIMATION_LIMITS.animatedShapes && on.some((t) => !GLOBAL_KINDS.includes(t.kind) && !isUniform(t)),
    color: on.some((t) => t.kind === "color"),
    moves: on.some((t) => t.kind === "rotate" || t.kind === "float"),
  };
}

function fillValues(variant: FillVariant, v: number): [number, number, number, number] {
  "worklet";
  // [opacity, scale, reveal, wipe]
  if (variant === "fade") return [v, 0.97 + 0.03 * v, 1, 0];
  if (variant === "bloom") return [v, 0.85 + 0.15 * v, 1, 0];
  return [v > 0 ? 1 : 0, 1, v, wipeIndex(variant)];
}

/**
 * Everything to draw at `progress` (0..1). Tracks for all shapes without stagger act on the
 * layers; with `perShape` (see animationFeatures) the other tracks act on single shapes, without
 * it tracks for all shapes still act (without stagger) and tracks for single shapes are left out.
 */
export function evaluateFrame(spec: AnimationSpec, progress: number, layout: ShapeLayout, perShape: boolean): AnimFrame {
  "worklet";
  const p = clamp01(progress);
  const tracks = spec.tracks;
  let hasDraw = false;
  let hasFill = false;
  for (let i = 0; i < tracks.length; i += 1) {
    const t = tracks[i];
    if (t === undefined || !t.enabled) continue;
    if (t.kind === "draw") hasDraw = true;
    if (t.kind === "fill") hasFill = true;
  }
  let drawn = 1;
  let strokeOpacity = hasDraw ? 1 : 0;
  let strokeScale = 1;
  let fillOpacity = hasFill ? 1 : 0;
  let fillScale = 1;
  let fillReveal = 1;
  let fillWipe = 0;
  let shine = 0;
  let shineOpacity = 0;
  const waves: { scale: number; opacity: number }[] = [];
  let dotsGlow = 0;
  let dotsSpread = 0;
  const sparks: number[] = [];
  let breathe = 0;
  let shrink = 1;
  let logoOpacity = 1;
  let logoRotate = 0;
  let logoDx = 0;
  let logoDy = 0;
  let colorFrom = 0;
  let colorTo = 0;
  let colorMix = 0;
  let anyShapeTrack = false;

  for (let i = 0; i < tracks.length; i += 1) {
    const t = tracks[i];
    if (t === undefined || !t.enabled) continue;
    const uniform = t.target.type === "all" && (t.stagger.mode === "none" || !perShape);
    if (!uniform) {
      anyShapeTrack = true;
      continue;
    }
    const q = trackTime(t, p, 0);
    const v = keyframeValue(t.keyframes, q);
    switch (t.kind) {
      case "draw":
        drawn = v;
        break;
      case "fill": {
        const f = fillValues(t.variant, v);
        fillOpacity = f[0];
        fillScale = f[1];
        fillReveal = f[2];
        fillWipe = f[3];
        break;
      }
      case "shine":
        if (inSpan(t.keyframes, q)) {
          shine = v;
          shineOpacity = t.strength;
        }
        break;
      case "wave": {
        const live = inSpan(t.keyframes, q);
        const first = t.keyframes[0];
        const last = t.keyframes[t.keyframes.length - 1];
        const grow = live && first !== undefined && last !== undefined ? interpolate(0, 1, t.grow, segment(q, first.t, last.t)) : 0;
        waves.push({ scale: live ? WAVE_START + (t.scale - WAVE_START) * grow : WAVE_START, opacity: live ? v : 0 });
        break;
      }
      case "dots":
        if (t.variant === "glow") dotsGlow = v;
        else dotsSpread = v;
        break;
      case "sparks":
        sparks.push(inSpan(t.keyframes, q) ? v : -1);
        break;
      case "breathe":
        breathe += v;
        break;
      case "rotate":
        logoRotate += v;
        break;
      case "float":
        if (t.axis === "x") logoDx += v;
        else logoDy += v;
        break;
      case "exit":
        if (t.layer === "all") {
          if (t.variant === "fade") logoOpacity *= 1 - v;
          else shrink *= 1 - t.amount * v;
        } else if (t.layer === "outline") {
          if (t.variant === "fade") strokeOpacity *= 1 - v;
          else strokeScale *= 1 - t.amount * v;
        } else if (t.variant === "fade") fillOpacity *= 1 - v;
        else fillScale *= 1 - t.amount * v;
        break;
      case "color":
        colorFrom = colorIndex(t.from);
        colorTo = colorIndex(t.to);
        colorMix = v;
        break;
    }
  }
  const shapes: ShapeFrame[] = [];
  if (perShape && anyShapeTrack) {
    for (let s = 0; s < layout.count; s += 1) {
      let draw = drawn;
      let outlineOpacity = 1;
      let sFillOpacity = 1;
      let sFillScale = 1;
      let reveal = 1;
      let wipe = 0;
      let opacity = 1;
      let sBreathe = 0;
      let sShrink = 1;
      let rotate = 0;
      let dx = 0;
      let dy = 0;
      let from = colorFrom;
      let to = colorTo;
      let mix = colorMix;
      for (let i = 0; i < tracks.length; i += 1) {
        const t = tracks[i];
        if (t === undefined || !t.enabled) continue;
        if (t.target.type === "all" && t.stagger.mode === "none") continue;
        if (!matches(t, layout, s)) continue;
        const v = keyframeValue(t.keyframes, trackTime(t, p, staggerDelay(t.stagger, layout, s)));
        switch (t.kind) {
          case "draw":
            draw = v;
            break;
          case "fill": {
            const f = fillValues(t.variant, v);
            sFillOpacity = f[0];
            sFillScale = f[1];
            reveal = f[2];
            wipe = f[3];
            break;
          }
          case "breathe":
            sBreathe += v;
            break;
          case "rotate":
            rotate += v;
            break;
          case "float":
            if (t.axis === "x") dx += v;
            else dy += v;
            break;
          case "exit":
            if (t.layer === "all") {
              if (t.variant === "fade") opacity *= 1 - v;
              else sShrink *= 1 - t.amount * v;
            } else if (t.layer === "outline") {
              if (t.variant === "fade") outlineOpacity *= 1 - v;
            } else if (t.variant === "fade") sFillOpacity *= 1 - v;
            else sFillScale *= 1 - t.amount * v;
            break;
          case "color":
            from = colorIndex(t.from);
            to = colorIndex(t.to);
            mix = v;
            break;
          default:
            break;
        }
      }
      shapes.push({
        draw,
        outlineOpacity,
        fillOpacity: sFillOpacity,
        fillScale: sFillScale,
        reveal,
        wipe,
        opacity,
        scale: (1 + sBreathe) * sShrink,
        rotate,
        dx,
        dy,
        colorFrom: from,
        colorTo: to,
        colorMix: mix,
      });
    }
  }

  return {
    logoOpacity,
    logoScale: (1 + breathe) * shrink,
    logoRotate,
    logoDx,
    logoDy,
    strokeOffset: 1 - drawn,
    strokeOpacity,
    strokeScale,
    fillOpacity,
    fillScale,
    fillReveal,
    fillWipe,
    shine,
    shineOpacity,
    waves,
    dotsGlow,
    dotsSpread,
    sparks,
    colorFrom,
    colorTo,
    colorMix,
    shapes,
  };
}

/**
 * The calm still image ("Bewegung reduzieren", animation off, standbild test): the finished logo
 * in the accent, no wave, shine or sparks, nothing moved.
 */
export function stillAnimFrame(spec: AnimationSpec, layout: ShapeLayout, perShape: boolean): AnimFrame {
  "worklet";
  let hasFill = false;
  let hasDraw = false;
  let waves = 0;
  let sparks = 0;
  for (let i = 0; i < spec.tracks.length; i += 1) {
    const t = spec.tracks[i];
    if (t === undefined || !t.enabled) continue;
    if (t.kind === "fill") hasFill = true;
    if (t.kind === "draw") hasDraw = true;
    if (t.kind === "wave") waves += 1;
    if (t.kind === "sparks") sparks += 1;
  }
  const shapes: ShapeFrame[] = [];
  if (perShape) {
    for (let s = 0; s < layout.count; s += 1) {
      shapes.push({
        draw: 1,
        outlineOpacity: 1,
        fillOpacity: 1,
        fillScale: 1,
        reveal: 1,
        wipe: 0,
        opacity: 1,
        scale: 1,
        rotate: 0,
        dx: 0,
        dy: 0,
        colorFrom: 0,
        colorTo: 0,
        colorMix: 0,
      });
    }
  }
  const waveList: { scale: number; opacity: number }[] = [];
  for (let i = 0; i < waves; i += 1) waveList.push({ scale: WAVE_START, opacity: 0 });
  const sparkList: number[] = [];
  for (let i = 0; i < sparks; i += 1) sparkList.push(-1);
  return {
    logoOpacity: 1,
    logoScale: 1,
    logoRotate: 0,
    logoDx: 0,
    logoDy: 0,
    strokeOffset: 0,
    strokeOpacity: hasFill ? 0 : hasDraw ? 1 : 0,
    strokeScale: 1,
    fillOpacity: hasFill ? 1 : 0,
    fillScale: 1,
    fillReveal: 1,
    fillWipe: 0,
    shine: 0,
    shineOpacity: 0,
    waves: waveList,
    dotsGlow: 0,
    dotsSpread: 0,
    sparks: sparkList,
    colorFrom: 0,
    colorTo: 0,
    colorMix: 0,
    shapes,
  };
}

// ------------------------------------------------------------------ sparks

export type Spark = { angle: number; speed: number; size: number };

/** Directions, speeds and sizes of a sparks track (deterministic from the seed). */
export function sparkLayout(count: number, seed: number): Spark[] {
  const n = Math.max(0, Math.min(ANIMATION_LIMITS.sparksTotal, Math.round(count)));
  return Array.from({ length: n }, (_, j) => ({
    angle: (2 * Math.PI * (j + 0.8 * seededRandom(seed, j))) / Math.max(1, n),
    speed: 0.6 + 0.4 * seededRandom(seed, j + 1000),
    size: 0.6 + 0.8 * seededRandom(seed, j + 2000),
  }));
}

/** Position (stage units from the centre), radius and opacity of a spark at flight f (0..1). */
export function sparkAt(spark: Spark, distance: number, size: number, f: number): { x: number; y: number; r: number; opacity: number } {
  "worklet";
  if (f < 0) return { x: 0, y: 0, r: 0, opacity: 0 };
  const radius = 40 + distance * 60 * spark.speed * f;
  const opacity = f < 0.15 ? f / 0.15 : (1 - f) / 0.85;
  return { x: Math.cos(spark.angle) * radius, y: Math.sin(spark.angle) * radius, r: size * spark.size * (1 - 0.5 * f), opacity: Math.max(0, opacity) };
}

// ------------------------------------------------------------------ device limits

/**
 * The same animation with less work for weaker devices, without changing its course: level 1
 * fewer sparks (at most 12), at most 2 waves, the dot "Verlauf" as glow and wider dots; level 2
 * no sparks and no shine, one wave, a calm raster. Drawing, fill, motion and exit stay.
 */
export function limitAnimation(spec: AnimationSpec, level: 0 | 1 | 2): AnimationSpec {
  if (level === 0) return spec;
  const sparksTotal = spec.tracks.reduce((sum, t) => sum + (t.enabled && t.kind === "sparks" ? t.count : 0), 0);
  const sparkShare = level === 1 && sparksTotal > 12 ? 12 / sparksTotal : 1;
  let waves = 0;
  const tracks: Track[] = [];
  for (const t of spec.tracks) {
    if (!t.enabled) continue;
    if (t.kind === "sparks") {
      if (level === 2) continue;
      tracks.push({ ...t, count: Math.max(1, Math.floor(t.count * sparkShare)) });
    } else if (t.kind === "wave") {
      waves += 1;
      if (waves <= (level === 1 ? 2 : 1)) tracks.push(t);
    } else if (t.kind === "shine") {
      if (level === 1) tracks.push(t);
    } else if (t.kind === "dots") {
      const spacing = Math.min(28, t.spacing * (level === 1 ? 1.3 : 1.6));
      tracks.push(
        level === 1
          ? { ...t, variant: "glow", spacing }
          : { ...t, variant: "glow", spacing, keyframes: [{ t: 0, v: 0, ease: LINEAR }] },
      );
    } else tracks.push(t);
  }
  return { ...spec, tracks };
}

// ------------------------------------------------------------------ v1 -> v2

function v1Curve(params: PresetParams, curve: "draw" | "fill" | "wave" | "inOut"): EasingSpec {
  if (params.easing === "linear") return LINEAR;
  const [x1, y1, x2, y2] = CURVES[params.easing][curve];
  return { type: "bezier", x1, y1, x2, y2 };
}

const ALL: Target = { type: "all" };
const NO_STAGGER: Stagger = { mode: "none", amount: 0, seed: 0 };
const base = { enabled: true, target: ALL, stagger: NO_STAGGER, repeat: 1 };

/**
 * A v1 preset as v2, frame for frame the same values (see the test against brandFrame): every
 * phase of brandTimeline becomes a track with the same times, curves and values.
 */
export function migrateV1(params: PresetParams): AnimationSpec {
  const t = brandTimeline(params);
  const tracks: Track[] = [];
  const reverse = (e: EasingSpec): EasingSpec => ({ ...e, reverse: true });
  if (params.dots) {
    tracks.push({
      ...base,
      kind: "dots",
      variant: "glow",
      spacing: params.dotSpacing,
      radius: params.dotRadius,
      glowRadius: params.dotGlowRadius,
      fade: params.dotFade,
      keyframes: [{ t: 0, v: 0, ease: LINEAR }],
    });
  }
  if (params.wave) {
    tracks.push({
      ...base,
      kind: "wave",
      scale: params.waveScale,
      grow: v1Curve(params, "wave"),
      keyframes: [
        { t: t.waveStart, v: 0, ease: LINEAR },
        { t: t.wavePeak, v: params.waveStrength, ease: reverse(LINEAR) },
        { t: t.waveEnd, v: 0, ease: LINEAR },
      ],
    });
  }
  if (params.drawLine) {
    tracks.push({
      ...base,
      kind: "draw",
      keyframes: [
        { t: 0, v: 0, ease: v1Curve(params, "draw") },
        { t: t.drawEnd, v: 1, ease: LINEAR },
      ],
    });
  } else if (!params.fill) {
    tracks.push({ ...base, kind: "draw", keyframes: [{ t: 0, v: 1, ease: LINEAR }] });
  }
  if (params.fill) {
    tracks.push({
      ...base,
      kind: "fill",
      variant: params.fillMode,
      keyframes: [
        { t: t.fillStart, v: 0, ease: v1Curve(params, "fill") },
        { t: t.fillEnd, v: 1, ease: LINEAR },
      ],
    });
    if (params.drawLine) {
      tracks.push({
        ...base,
        kind: "exit",
        variant: "fade",
        layer: "outline",
        amount: 0.4,
        keyframes: [
          { t: t.strokeOutStart, v: 0, ease: LINEAR },
          { t: t.strokeOutEnd, v: 1, ease: LINEAR },
        ],
      });
    }
    if (params.shine) {
      tracks.push({
        ...base,
        kind: "shine",
        width: params.shineWidth,
        angle: params.shineAngle,
        strength: SHINE_STRENGTH,
        keyframes: [
          { t: t.shineStart, v: 0, ease: v1Curve(params, "inOut") },
          { t: t.shineEnd, v: 1, ease: LINEAR },
        ],
      });
    }
  }
  if (params.breathe) {
    const amount = params.breatheStrength / 100;
    tracks.push({
      ...base,
      kind: "breathe",
      keyframes: [
        { t: t.breatheStart, v: 0, ease: v1Curve(params, "inOut") },
        { t: t.breathePeak, v: amount, ease: reverse(v1Curve(params, "inOut")) },
        { t: t.breatheEnd, v: 0, ease: LINEAR },
      ],
    });
  }
  if (params.exit !== "none") {
    tracks.push({
      ...base,
      kind: "exit",
      variant: "fade",
      layer: "all",
      amount: 0.4,
      keyframes: [
        { t: t.exitStart, v: 0, ease: LINEAR },
        { t: t.exitEnd, v: 1, ease: LINEAR },
      ],
    });
    if (params.exit === "shrink") {
      tracks.push({
        ...base,
        kind: "exit",
        variant: "shrink",
        layer: "all",
        amount: 0.4,
        keyframes: [
          { t: t.exitStart, v: 0, ease: v1Curve(params, "inOut") },
          { t: t.exitEnd, v: 1, ease: LINEAR },
        ],
      });
    }
  }
  return { version: 2, duration: params.duration, strokeWidth: params.strokeWidth, tracks };
}

export const STANDARD_ANIMATION: AnimationSpec = migrateV1(STANDARD_PARAMS);

/**
 * A stored or received animation: v2 checked, v1 parameters checked and converted; null when it
 * is neither (callers fall back to the standard).
 */
export function parseAnimation(value: unknown): AnimationSpec | null {
  if (isRecord(value) && value.version === ANIMATION_VERSION) {
    const checked = validateAnimationSpec(value);
    return checked.ok ? checked.spec : null;
  }
  const v1 = validatePresetParams(value);
  return v1.ok ? migrateV1(v1.params) : null;
}
