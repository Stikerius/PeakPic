// Pure logic of the animation editor (unit tested in src/lib/__tests__/animationEditor.test.ts):
// history, keyframe and track operations, the tools and import/export. Every operation returns a
// new spec and keeps the rules of validateAnimationSpec (ranges, counts, rising times).

import {
  ANIMATION_LIMITS,
  BUILTIN_PRESETS,
  COST_LIMITS,
  LINEAR,
  STAGGER_LABELS,
  STANDARD_ANIMATION,
  TRACK_LABELS,
  VALUE_RANGES,
  animationCost,
  keyframeValue,
  migrateV1,
  parseAnimation,
  seededRandom,
  validateAnimationSpec,
  validatePresetParams,
  type AnimationSpec,
  type EasingSpec,
  type Keyframe,
  type PresetParams,
  type ShapeRole,
  type Stagger,
  type Track,
  type TrackKind,
} from "./brand";

// ------------------------------------------------------------------ history

export const HISTORY_LIMIT = 100;

export type History<T> = { past: T[]; present: T; future: T[] };

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** A new state; the oldest steps beyond HISTORY_LIMIT are dropped, redo is cleared. */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

// ------------------------------------------------------------------ helpers

export type KeyRef = { track: number; key: number };

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;
const clamp = (x: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, x));
/** Smallest distance between two keyframes of a track. */
export const MIN_GAP = 0.001;

export function snapTime(t: number, grid: number): number {
  const snapped = grid > 0 ? Math.round(t / grid) * grid : t;
  return round(clamp(snapped, [0, 1]));
}

function withTrack(spec: AnimationSpec, index: number, change: (track: Track) => Track): AnimationSpec {
  return { ...spec, tracks: spec.tracks.map((t, i) => (i === index ? change(t) : t)) };
}

/**
 * Keyframes sorted by time, at least MIN_GAP apart (later ones are pushed back, and if they would
 * run past 1, earlier ones forward), times rounded.
 */
export function tidyKeyframes(keyframes: Keyframe[]): Keyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t).map((k) => ({ ...k, t: round(clamp(k.t, [0, 1])) }));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined && cur.t < prev.t + MIN_GAP) sorted[i] = { ...cur, t: round(prev.t + MIN_GAP) };
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const limit = next === undefined ? 1 : next.t - MIN_GAP;
    if (cur !== undefined && cur.t > limit) sorted[i] = { ...cur, t: round(limit) };
  }
  return sorted;
}

// ------------------------------------------------------------------ keyframes

/**
 * Moves the selected keyframes by dt (snapped to the grid when set). Returns the spec and where
 * the moved keyframes ended up (their order can change).
 */
export function moveKeyframes(spec: AnimationSpec, refs: readonly KeyRef[], dt: number, grid = 0): { spec: AnimationSpec; refs: KeyRef[] } {
  const newRefs: KeyRef[] = [];
  const tracks = spec.tracks.map((track, ti) => {
    const selected = new Set(refs.filter((r) => r.track === ti).map((r) => r.key));
    if (selected.size === 0) return track;
    const marked = track.keyframes.map((k, ki) => ({ ...k, t: selected.has(ki) ? snapTime(k.t + dt, grid) : k.t, moved: selected.has(ki) }));
    const tidy = tidyKeyframes(marked);
    tidy.forEach((k, ki) => {
      if ((k as Keyframe & { moved?: boolean }).moved === true) newRefs.push({ track: ti, key: ki });
    });
    return { ...track, keyframes: tidy.map(({ t, v, ease }) => ({ t, v, ease })) };
  });
  return { spec: { ...spec, tracks }, refs: newRefs };
}

export function setKeyframe(spec: AnimationSpec, ref: KeyRef, change: Partial<Keyframe>): AnimationSpec {
  return withTrack(spec, ref.track, (track) => {
    const keyframes = track.keyframes.map((k, i) => {
      if (i !== ref.key) return k;
      return { t: change.t ?? k.t, v: change.v !== undefined ? round(clamp(change.v, VALUE_RANGES[track.kind])) : k.v, ease: change.ease ?? k.ease };
    });
    return { ...track, keyframes: change.t !== undefined ? tidyKeyframes(keyframes) : keyframes };
  });
}

/** A keyframe at time t with the value the track has there; null when the track is full or one is already there. */
export function addKeyframe(spec: AnimationSpec, trackIndex: number, t: number): { spec: AnimationSpec; ref: KeyRef } | null {
  const track = spec.tracks[trackIndex];
  if (track === undefined || track.keyframes.length >= ANIMATION_LIMITS.keyframes) return null;
  const time = round(clamp(t, [0, 1]));
  if (track.keyframes.some((k) => Math.abs(k.t - time) < MIN_GAP)) return null;
  const v = round(clamp(keyframeValue(track.keyframes, time), VALUE_RANGES[track.kind]));
  const keyframes = [...track.keyframes, { t: time, v, ease: LINEAR }].sort((a, b) => a.t - b.t);
  return { spec: withTrack(spec, trackIndex, (tr) => ({ ...tr, keyframes })), ref: { track: trackIndex, key: keyframes.findIndex((k) => k.t === time) } };
}

/** Removes keyframes; every track keeps at least one. */
export function deleteKeyframes(spec: AnimationSpec, refs: readonly KeyRef[]): AnimationSpec {
  return {
    ...spec,
    tracks: spec.tracks.map((track, ti) => {
      const drop = new Set(refs.filter((r) => r.track === ti).map((r) => r.key));
      const kept = track.keyframes.filter((_, ki) => !drop.has(ki));
      return kept.length > 0 ? { ...track, keyframes: kept } : { ...track, keyframes: track.keyframes.slice(0, 1) };
    }),
  };
}

export type Clipboard = { items: { dt: number; v: number; ease: EasingSpec }[] };

/** Copies keyframes of one track (times relative to the first copied one). */
export function copyKeyframes(spec: AnimationSpec, refs: readonly KeyRef[]): Clipboard | null {
  const sorted = [...refs].sort((a, b) => a.track - b.track || a.key - b.key);
  const firstRef = sorted[0];
  if (firstRef === undefined) return null;
  const frames = sorted.flatMap((r) => (r.track === firstRef.track ? [spec.tracks[r.track]?.keyframes[r.key]] : [])).filter((k): k is Keyframe => k !== undefined);
  const first = frames[0];
  if (first === undefined) return null;
  return { items: frames.map((k) => ({ dt: k.t - first.t, v: k.v, ease: k.ease })) };
}

/**
 * Pastes at time `at` into a track: values are clamped to its range, a keyframe at the same time
 * is replaced, nothing beyond 12 keyframes or past the end of the loop.
 */
export function pasteKeyframes(spec: AnimationSpec, clip: Clipboard, trackIndex: number, at: number): AnimationSpec {
  return withTrack(spec, trackIndex, (track) => {
    let keyframes = [...track.keyframes];
    for (const item of clip.items) {
      const t = round(at + item.dt);
      if (t > 1) continue;
      keyframes = keyframes.filter((k) => Math.abs(k.t - t) >= MIN_GAP);
      if (keyframes.length >= ANIMATION_LIMITS.keyframes) break;
      keyframes.push({ t, v: round(clamp(item.v, VALUE_RANGES[track.kind])), ease: item.ease });
    }
    return { ...track, keyframes: tidyKeyframes(keyframes) };
  });
}

// ------------------------------------------------------------------ tracks

const NO_STAGGER: Stagger = { mode: "none", amount: 0, seed: 0 };

/** A new track of a kind with sensible values (two keyframes over the middle of the loop). */
export function defaultTrack(kind: TrackKind): Track {
  const kf = (t: number, v: number, ease: EasingSpec = { type: "preset", name: "easeInOut" }): Keyframe => ({ t, v, ease });
  const base = { enabled: true, target: { type: "all" as const }, stagger: NO_STAGGER, repeat: 1 };
  switch (kind) {
    case "draw":
      return { ...base, kind, keyframes: [kf(0, 0), kf(0.3, 1)] };
    case "fill":
      return { ...base, kind, variant: "fade", keyframes: [kf(0.25, 0, { type: "preset", name: "easeOut" }), kf(0.42, 1)] };
    case "shine":
      return { ...base, kind, width: 50, angle: 12, strength: 0.55, keyframes: [kf(0.45, 0), kf(0.65, 1)] };
    case "wave":
      return { ...base, kind, scale: 6, grow: { type: "bezier", x1: 0.2, y1: 0.6, x2: 0.3, y2: 1 }, keyframes: [kf(0.4, 0, LINEAR), kf(0.42, 0.95, { ...LINEAR, reverse: true }), kf(0.62, 0, LINEAR)] };
    case "dots":
      return { ...base, kind, variant: "glow", spacing: 18, radius: 1.1, glowRadius: 1.6, fade: 0.35, keyframes: [kf(0, 0)] };
    case "sparks":
      return { ...base, kind, count: 12, seed: 7, size: 1.5, distance: 1, keyframes: [kf(0.45, 0, { type: "preset", name: "easeOut" }), kf(0.75, 1)] };
    case "breathe":
      return { ...base, kind, keyframes: [kf(0.5, 0), kf(0.65, 0.02), kf(0.8, 0)] };
    case "rotate":
      return { ...base, kind, keyframes: [kf(0.3, 0), kf(0.6, 360)] };
    case "float":
      return { ...base, kind, axis: "y", keyframes: [kf(0.4, 0), kf(0.55, -4), kf(0.7, 0)] };
    case "exit":
      return { ...base, kind, variant: "fade", layer: "all", amount: 0.4, keyframes: [kf(0.82, 0, LINEAR), kf(0.95, 1, LINEAR)] };
    case "color":
      return { ...base, kind, from: "accent", to: "accentLight", keyframes: [kf(0.4, 0), kf(0.5, 1), kf(0.6, 0)] };
  }
}

export function addTrack(spec: AnimationSpec, kind: TrackKind): AnimationSpec | null {
  if (spec.tracks.length >= ANIMATION_LIMITS.tracks) return null;
  if (kind === "dots" && spec.tracks.some((t) => t.kind === "dots")) return null;
  return { ...spec, tracks: [...spec.tracks, defaultTrack(kind)] };
}

export function duplicateTrack(spec: AnimationSpec, index: number): AnimationSpec | null {
  const track = spec.tracks[index];
  if (track === undefined || spec.tracks.length >= ANIMATION_LIMITS.tracks || track.kind === "dots") return null;
  return { ...spec, tracks: [...spec.tracks.slice(0, index + 1), structuredClone(track), ...spec.tracks.slice(index + 1)] };
}

/** Removes a track; the last one stays. */
export function deleteTrack(spec: AnimationSpec, index: number): AnimationSpec {
  if (spec.tracks.length <= 1) return spec;
  return { ...spec, tracks: spec.tracks.filter((_, i) => i !== index) };
}

export function moveTrack(spec: AnimationSpec, from: number, to: number): AnimationSpec {
  if (to < 0 || to >= spec.tracks.length || from === to) return spec;
  const tracks = [...spec.tracks];
  const [track] = tracks.splice(from, 1);
  if (track === undefined) return spec;
  tracks.splice(to, 0, track);
  return { ...spec, tracks };
}

export function updateTrack(spec: AnimationSpec, index: number, change: Partial<Track>): AnimationSpec {
  return withTrack(spec, index, (t) => ({ ...t, ...change }) as Track);
}

/** For the preview only: with a solo track, the others are switched off. */
export function soloSpec(spec: AnimationSpec, solo: number | null): AnimationSpec {
  if (solo === null) return spec;
  return { ...spec, tracks: spec.tracks.map((t, i) => (i === solo ? { ...t, enabled: true } : { ...t, enabled: false })) };
}

// ------------------------------------------------------------------ tools

/** "Staffeln": start of each shape shifted by `amount` (share of the loop) in the chosen order. */
export function staggerTrack(spec: AnimationSpec, index: number, stagger: Stagger): AnimationSpec {
  const track = spec.tracks[index];
  if (track === undefined || ["shine", "wave", "dots", "sparks"].includes(track.kind)) return spec;
  return updateTrack(spec, index, { stagger: { mode: stagger.mode, amount: round(clamp(stagger.amount, ANIMATION_LIMITS.staggerAmount)), seed: Math.round(clamp(stagger.seed, ANIMATION_LIMITS.seed)) } });
}

/**
 * "Zufall": every keyframe value varied by up to `strength` (share of the value range) and the
 * times by up to `strength / 10`, deterministic from the seed, always within the ranges.
 */
export function randomize(spec: AnimationSpec, index: number | null, seed: number, strength = 0.1): AnimationSpec {
  let n = 0;
  const r = () => seededRandom(seed, n++) * 2 - 1;
  return {
    ...spec,
    tracks: spec.tracks.map((track, ti) => {
      if (index !== null && ti !== index) return track;
      const range = VALUE_RANGES[track.kind];
      const span = range[1] - range[0];
      const keyframes = track.keyframes.map((k) => ({
        ...k,
        v: round(clamp(k.v + r() * strength * span, range)),
        t: round(clamp(k.t + (r() * strength) / 10, [0, 1])),
      }));
      return { ...track, keyframes: tidyKeyframes(keyframes) };
    }),
  };
}

/** "Spiegeln der Zeit": the track runs backwards (time 1 - t), each segment keeps its curve, mirrored. */
export function mirrorTime(spec: AnimationSpec, index: number): AnimationSpec {
  return withTrack(spec, index, (track) => {
    const ks = track.keyframes;
    const flip = (e: EasingSpec): EasingSpec => {
      const { reverse, ...curve } = e;
      return (reverse === true ? curve : { ...curve, reverse: true }) as EasingSpec;
    };
    // Segment i (from ks[i] to ks[i+1]) becomes the segment that now starts at ks[i+1], mirrored.
    // The first keyframe ends up last and takes the unused curve of the old last one.
    const keyframes = ks
      .map((k, i) => {
        const previous = ks[i - 1];
        return { t: round(1 - k.t), v: k.v, ease: previous !== undefined ? flip(previous.ease) : (ks[ks.length - 1]?.ease ?? LINEAR) };
      })
      .reverse();
    return { ...track, keyframes: tidyKeyframes(keyframes) };
  });
}

/** "Tempo skalieren": times times `factor` around the first keyframe (beyond the loop end: clamped). */
export function scaleTempo(spec: AnimationSpec, index: number | null, factor: number): AnimationSpec {
  const f = clamp(factor, [0.25, 4]);
  return {
    ...spec,
    tracks: spec.tracks.map((track, ti) => {
      if (index !== null && ti !== index) return track;
      const start = track.keyframes[0]?.t ?? 0;
      return { ...track, keyframes: tidyKeyframes(track.keyframes.map((k) => ({ ...k, t: start + (k.t - start) * f }))) };
    }),
  };
}

// ------------------------------------------------------------------ templates

export type Template = { id: string; name: string; spec: AnimationSpec };

const kf = (t: number, v: number, ease: EasingSpec = { type: "preset", name: "easeInOut" }): Keyframe => ({ t, v, ease });
const pick = (kinds: TrackKind[]) => STANDARD_ANIMATION.tracks.filter((t) => kinds.includes(t.kind));

/** A default track of a kind with some fields changed. */
export function make<K extends TrackKind>(kind: K, change: Partial<Extract<Track, { kind: K }>>): Track {
  return { ...defaultTrack(kind), ...change } as Track;
}

/** The built-in presets as v2 and the extra templates of the editor. All valid and below the warning. */
export const TEMPLATES: readonly Template[] = [
  ...BUILTIN_PRESETS.map((p) => ({ id: p.id, name: p.name, spec: migrateV1(p.params) })),
  {
    id: "pulse",
    name: "Pulsieren",
    spec: {
      version: 2,
      duration: 4,
      strokeWidth: 2.4,
      tracks: [
        make("dots", { keyframes: [kf(0, 0), kf(0.5, 0.35), kf(1, 0)] }),
        make("fill", { keyframes: [kf(0, 1)] }),
        make("breathe", { repeat: 2, keyframes: [kf(0, 0), kf(0.5, 0.04), kf(1, 0)] }),
      ],
    },
  },
  {
    id: "sparkle",
    name: "Funkeln",
    spec: {
      version: 2,
      duration: 6,
      strokeWidth: 2.4,
      tracks: [
        ...pick(["dots", "draw", "fill"]),
        make("shine", { keyframes: [kf(0.45, 0), kf(0.65, 1)] }),
        make("sparks", { count: 16, seed: 11, keyframes: [kf(0.42, 0, { type: "preset", name: "easeOutStrong" }), kf(0.8, 1)] }),
        make("exit", { keyframes: [kf(0.85, 0, LINEAR), kf(0.97, 1, LINEAR)] }),
      ],
    },
  },
  {
    id: "wave-start",
    name: "Wellenstart",
    spec: {
      version: 2,
      duration: 7,
      strokeWidth: 2.4,
      tracks: [
        ...pick(["dots"]),
        ...[0.05, 0.15, 0.25].map((start) =>
          make("wave", { keyframes: [kf(start, 0, LINEAR), kf(start + 0.02, 0.8, { ...LINEAR, reverse: true }), kf(start + 0.25, 0, LINEAR)] }),
        ),
        make("fill", { variant: "wipeUp", keyframes: [kf(0.3, 0, { type: "preset", name: "easeOut" }), kf(0.5, 1)] }),
        make("exit", { keyframes: [kf(0.85, 0, LINEAR), kf(0.97, 1, LINEAR)] }),
      ],
    },
  },
  {
    id: "draw-rotate",
    name: "Zeichnen und Drehen",
    spec: {
      version: 2,
      duration: 8,
      strokeWidth: 2.4,
      tracks: [
        ...pick(["dots"]),
        make("draw", { stagger: { mode: "order", amount: 0.1, seed: 0 }, keyframes: [kf(0, 0), kf(0.3, 1)] }),
        make("rotate", { keyframes: [kf(0.05, -30, { type: "spring", damping: 0.4, frequency: 2 }), kf(0.45, 0)] }),
        make("fill", { keyframes: [kf(0.35, 0, { type: "preset", name: "easeOut" }), kf(0.5, 1)] }),
        make("exit", { variant: "fade", layer: "outline", keyframes: [kf(0.45, 0, LINEAR), kf(0.55, 1, LINEAR)] }),
        make("exit", { keyframes: [kf(0.85, 0, LINEAR), kf(0.97, 1, LINEAR)] }),
      ],
    },
  },
];

// ------------------------------------------------------------------ labels

const ROLE_LABELS: Record<ShapeRole, string> = { fill: "Flächen", cutout: "Aussparungen", stroke: "Linien" };

export function targetLabel(track: Track): string {
  const t = track.target;
  if (t.type === "all") return "alle Formen";
  if (t.type === "shape") return `Form ${t.index + 1}`;
  return ROLE_LABELS[t.role];
}

/** "Spur 2: Füllen, alle Formen, gestaffelt, stumm" (also the accessible name). */
export function trackLabel(track: Track, index: number): string {
  const parts = [`Spur ${index + 1}: ${TRACK_LABELS[track.kind]}`, targetLabel(track)];
  if (track.stagger.mode !== "none") parts.push(`gestaffelt ${STAGGER_LABELS[track.stagger.mode].toLowerCase()}`);
  if (track.repeat > 1) parts.push(`${track.repeat}-mal`);
  if (!track.enabled) parts.push("stumm");
  return parts.join(", ");
}

// ------------------------------------------------------------------ import / export

export const EXPORT_FORMAT = "peakpic-animation";
export const MAX_IMPORT_BYTES = 64 * 1024;

export function exportAnimation(name: string, spec: AnimationSpec): string {
  return JSON.stringify({ format: EXPORT_FORMAT, name: name.slice(0, 40), animation: spec }, null, 2);
}

export type ImportResult = { ok: true; name: string; spec: AnimationSpec } | { ok: false; error: string };

/**
 * Reads an exported file like an upload: size, JSON, format, then the same check as the server
 * (validateAnimationSpec). A bare spec is accepted too. Nothing of the file is ever run.
 */
export function importAnimation(text: string, bytes: number): ImportResult {
  if (bytes > MAX_IMPORT_BYTES) return { ok: false, error: "Die Datei ist grösser als 64 KB." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Die Datei ist kein gültiges JSON." };
  }
  const wrapped = typeof data === "object" && data !== null && !Array.isArray(data) && (data as Record<string, unknown>).format === EXPORT_FORMAT;
  const record = data as Record<string, unknown>;
  const checked = validateAnimationSpec(wrapped ? record.animation : data);
  if (!checked.ok) return { ok: false, error: `Die Animation erfüllt die Regeln nicht: ${checked.error}` };
  const rawName = wrapped && typeof record.name === "string" ? record.name.trim().slice(0, 40) : "";
  return { ok: true, name: rawName.length > 0 ? rawName : "Importierte Animation", spec: checked.spec };
}

/** Cost of the spec for a logo, with its rating. */
export function costRating(spec: AnimationSpec, shapes: number): { cost: number; level: "ok" | "warn" | "over" } {
  const cost = animationCost(spec, shapes);
  const worst = animationCost(spec);
  return { cost, level: worst > COST_LIMITS.hard ? "over" : cost > COST_LIMITS.soft ? "warn" : "ok" };
}

// ------------------------------------------------------------------ presets

/** The Animation v2 of a stored preset (v1 converted), else the standard. */
export function presetSpec(preset: { animation: unknown } | undefined): AnimationSpec {
  return parseAnimation(preset?.animation) ?? STANDARD_ANIMATION;
}

/** The v1 parameters behind "Einfach": stored ones, those of an old v1 preset, else null. */
export function presetParams(preset: { animation: unknown; params: unknown } | undefined): PresetParams | null {
  const stored = validatePresetParams(preset?.params);
  if (stored.ok) return stored.params;
  const legacy = validatePresetParams(preset?.animation);
  return legacy.ok ? legacy.params : null;
}
