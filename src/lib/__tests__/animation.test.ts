import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  ANIMATION_LIMITS,
  COST_LIMITS,
  EMPTY_LAYOUT,
  STANDARD_ANIMATION,
  animationCost,
  animationFeatures,
  evaluateFrame,
  keyframeValue,
  limitAnimation,
  migrateV1,
  parseAnimation,
  seededRandom,
  shapeLayout,
  sparkLayout,
  stillAnimFrame,
  trackTime,
  validateAnimationSpec,
  value,
  type AnimFrame,
  type AnimationSpec,
  type Track,
} from "../../../shared/brand/animation";
import { APP_LOGO_SPEC, FLAME_LOGO_SPEC } from "../../../shared/brand/logoSpec";
import { BUILTIN_PRESETS, PRESET_CHOICES, PRESET_RANGES, STANDARD_PARAMS, type PresetParams } from "../../../shared/brand/presets";
import { brandFrame, brandTimeline, stillFrame, type BrandFrame } from "../../../shared/brand/timeline";

/** The v1 view of a v2 frame (the values brandFrame returns). */
function legacy(frame: AnimFrame): BrandFrame {
  return {
    strokeOffset: frame.strokeOffset,
    strokeOpacity: frame.strokeOpacity,
    fillOpacity: frame.fillOpacity,
    fillScale: frame.fillScale,
    fillReveal: frame.fillReveal,
    waveScale: frame.waves[0]?.scale ?? 0.15,
    waveOpacity: frame.waves[0]?.opacity ?? 0,
    shine: frame.shine,
    shineOpacity: frame.shineOpacity,
    logoScale: frame.logoScale,
    logoOpacity: frame.logoOpacity,
  };
}

/** Times to compare: 400 even steps plus every phase boundary and its neighbours. */
function samples(params: PresetParams): number[] {
  const t = brandTimeline(params);
  const edges = Object.values(t).flatMap((x) => [x, x - 1e-9, x + 1e-9]);
  return [...Array.from({ length: 401 }, (_, i) => i / 400), ...edges, 0, 1].filter((x) => x >= 0 && x <= 1);
}

function expectSameAsV1(params: PresetParams) {
  const spec = migrateV1(params);
  expect(validateAnimationSpec(spec)).toEqual({ ok: true, spec });
  const timeline = brandTimeline(params);
  for (const p of samples(params)) {
    const expected = brandFrame(p, params, timeline);
    const actual = legacy(evaluateFrame(spec, p, EMPTY_LAYOUT, false));
    // Exactly the same numbers (Object.is), not just close.
    for (const key of Object.keys(expected) as (keyof BrandFrame)[]) {
      if (!Object.is(actual[key], expected[key])) throw new Error(`${key} at ${p}: ${actual[key]} != ${expected[key]}`);
    }
  }
  expect(legacy(stillAnimFrame(spec, EMPTY_LAYOUT, false))).toEqual(stillFrame(params));
}

/** Random but repeatable v1 parameters. */
function randomParams(seed: number): PresetParams {
  let i = 0;
  const r = () => seededRandom(seed, i++);
  const out: Record<string, unknown> = {};
  for (const [key, [min, max]] of Object.entries(PRESET_RANGES)) out[key] = Math.round((min + (max - min) * r()) * 100) / 100;
  for (const key of ["drawLine", "fill", "shine", "wave", "dots", "breathe"]) out[key] = r() > 0.3;
  for (const [key, options] of Object.entries(PRESET_CHOICES)) out[key] = options[Math.floor(r() * options.length)];
  return out as PresetParams;
}

describe("v1 presets as v2", () => {
  it("Standard: exactly the same values as before, frame for frame", () => {
    expectSameAsV1(STANDARD_PARAMS);
    expect(STANDARD_ANIMATION).toEqual(migrateV1(STANDARD_PARAMS));
  });

  it("all built-in presets stay the same", () => {
    for (const preset of BUILTIN_PRESETS) expectSameAsV1(preset.params);
  });

  it("any valid v1 preset stays the same", () => {
    for (let seed = 1; seed <= 120; seed += 1) expectSameAsV1(randomParams(seed));
  });

  it("v1 is still readable: parseAnimation converts it", () => {
    expect(parseAnimation(STANDARD_PARAMS)).toEqual(STANDARD_ANIMATION);
    expect(parseAnimation(STANDARD_ANIMATION)).toEqual(STANDARD_ANIMATION);
    expect(parseAnimation({ ...STANDARD_PARAMS, duration: 99 })).toBeNull();
    expect(parseAnimation("Standard")).toBeNull();
  });
});

const track = (change: Partial<Track> & { kind: Track["kind"] }): Track =>
  ({
    enabled: true,
    target: { type: "all" },
    stagger: { mode: "none", amount: 0, seed: 0 },
    repeat: 1,
    keyframes: [
      { t: 0, v: 0, ease: { type: "preset", name: "linear" } },
      { t: 1, v: 1, ease: { type: "preset", name: "linear" } },
    ],
    ...change,
  }) as Track;
const spec = (tracks: Track[], change: Partial<AnimationSpec> = {}): AnimationSpec => ({ version: 2, duration: 8, strokeWidth: 2.4, tracks, ...change });

describe("check", () => {
  it("accepts the standard and keeps only known fields", () => {
    expect(validateAnimationSpec(STANDARD_ANIMATION).ok).toBe(true);
    expect(validateAnimationSpec({ ...STANDARD_ANIMATION, script: "x" }).ok).toBe(false);
    const withExtra = { ...STANDARD_ANIMATION, tracks: [{ ...STANDARD_ANIMATION.tracks[0], onload: "alert(1)" }] };
    expect(validateAnimationSpec(withExtra).ok).toBe(false);
  });

  it("refuses invalid and extreme numbers", () => {
    for (const duration of [1.9, 30.1, Number.NaN, Number.POSITIVE_INFINITY, "8", null]) {
      expect(validateAnimationSpec({ ...STANDARD_ANIMATION, duration }).ok).toBe(false);
    }
    const bad = (t: Partial<Track>) => validateAnimationSpec(spec([track({ kind: "rotate", ...t } as Track)])).ok;
    expect(bad({})).toBe(true);
    expect(bad({ keyframes: [{ t: 0, v: 400, ease: { type: "preset", name: "linear" } }] })).toBe(false);
    expect(bad({ keyframes: [{ t: 0, v: Number.NaN, ease: { type: "preset", name: "linear" } }] })).toBe(false);
    expect(bad({ keyframes: [{ t: 1.5, v: 0, ease: { type: "preset", name: "linear" } }] })).toBe(false);
    expect(bad({ keyframes: [{ t: 0, v: 0, ease: { type: "bezier", x1: 2, y1: 0, x2: 0.5, y2: 1 } }] })).toBe(false);
    expect(bad({ keyframes: [{ t: 0, v: 0, ease: { type: "spring", damping: 0.5, frequency: Number.POSITIVE_INFINITY } }] })).toBe(false);
    expect(bad({ keyframes: [{ t: 0, v: 0, ease: { type: "bounce", bounces: 2.5, damping: 0.5 } }] })).toBe(false);
    expect(bad({ repeat: 5 })).toBe(false);
    expect(bad({ repeat: 1.5 })).toBe(false);
    expect(bad({ stagger: { mode: "random", amount: 0.6, seed: 1 } })).toBe(false);
    expect(bad({ stagger: { mode: "random", amount: 0.2, seed: 1.5 } })).toBe(false);
    expect(bad({ target: { type: "shape", index: -1 } })).toBe(false);
    expect(bad({ target: { type: "shape", index: 2 } })).toBe(true);
  });

  it("keyframes must rise in time, 1 to 12 per track", () => {
    const kf = (t: number) => ({ t, v: 0, ease: { type: "preset" as const, name: "linear" as const } });
    expect(validateAnimationSpec(spec([track({ kind: "rotate", keyframes: [kf(0.5), kf(0.5)] })])).ok).toBe(false);
    expect(validateAnimationSpec(spec([track({ kind: "rotate", keyframes: [kf(0.6), kf(0.5)] })])).ok).toBe(false);
    expect(validateAnimationSpec(spec([track({ kind: "rotate", keyframes: [] })])).ok).toBe(false);
    const twelve = Array.from({ length: 12 }, (_, i) => kf(i / 12));
    expect(validateAnimationSpec(spec([track({ kind: "rotate", keyframes: twelve })])).ok).toBe(true);
    expect(validateAnimationSpec(spec([track({ kind: "rotate", keyframes: [...twelve, kf(1)] })])).ok).toBe(false);
  });

  it("at most 16 tracks, one dot raster, 40 sparks; global kinds act on everything", () => {
    expect(validateAnimationSpec(spec(Array.from({ length: 16 }, () => track({ kind: "rotate" })))).ok).toBe(true);
    expect(validateAnimationSpec(spec(Array.from({ length: 17 }, () => track({ kind: "rotate" })))).ok).toBe(false);
    const dots = track({ kind: "dots", variant: "glow", spacing: 18, radius: 1, glowRadius: 1.6, fade: 0.4 } as Partial<Track> & { kind: "dots" });
    expect(validateAnimationSpec(spec([dots, dots])).ok).toBe(false);
    const sparks = (count: number) => track({ kind: "sparks", count, seed: 1, size: 1, distance: 1 } as Partial<Track> & { kind: "sparks" });
    expect(validateAnimationSpec(spec([sparks(20), sparks(20)])).ok).toBe(true);
    expect(validateAnimationSpec(spec([sparks(20), sparks(21)])).ok).toBe(false);
    expect(validateAnimationSpec(spec([sparks(41)])).ok).toBe(false);
    const shine = { kind: "shine", width: 50, angle: 12, strength: 0.55 } as const;
    expect(validateAnimationSpec(spec([track({ ...shine, target: { type: "shape", index: 0 } })])).ok).toBe(false);
  });
});

describe("evaluation", () => {
  it("keyframes hold before and after, repeat and stagger shift the track time", () => {
    const kfs = [
      { t: 0.2, v: 10, ease: { type: "preset" as const, name: "linear" as const } },
      { t: 0.6, v: 30, ease: { type: "preset" as const, name: "linear" as const } },
    ];
    expect(keyframeValue(kfs, 0)).toBe(10);
    expect(keyframeValue(kfs, 0.4)).toBeCloseTo(20);
    expect(keyframeValue(kfs, 0.9)).toBe(30);
    const t = track({ kind: "rotate", repeat: 2 });
    expect(trackTime(t, 0.25, 0)).toBeCloseTo(0.5);
    expect(trackTime(t, 0.75, 0)).toBeCloseTo(0.5);
    expect(trackTime(t, 1, 0)).toBe(1);
    expect(trackTime(track({ kind: "rotate" }), 0.3, 0.2)).toBeCloseTo(0.1);
    expect(trackTime(track({ kind: "rotate" }), 0.1, 0.2)).toBe(0);
  });

  it("dashboard and app read the same values from the same function", () => {
    const layout = shapeLayout(APP_LOGO_SPEC);
    const s = spec([track({ kind: "rotate", stagger: { mode: "order", amount: 0.3, seed: 0 }, keyframes: [{ t: 0, v: 0, ease: { type: "preset", name: "linear" } }, { t: 1, v: 90, ease: { type: "preset", name: "linear" } }] })]);
    const frame = evaluateFrame(s, 0.5, layout, true);
    expect(frame.shapes).toHaveLength(APP_LOGO_SPEC.shapes.length);
    frame.shapes.forEach((shape, i) => expect(shape.rotate).toBe(value(s, i, 0, 0.5, layout)));
    // The first shape starts at once, the last one 0.3 of the loop later.
    expect(frame.shapes[0]?.rotate).toBeCloseTo(45);
    expect(frame.shapes[frame.shapes.length - 1]?.rotate).toBeCloseTo(90 * 0.2);
  });

  it("targets: one shape or a role", () => {
    const layout = shapeLayout(APP_LOGO_SPEC);
    const one = evaluateFrame(spec([track({ kind: "float", axis: "y", target: { type: "shape", index: 1 } } as Partial<Track> & { kind: "float" })]), 1, layout, true);
    expect(one.shapes.map((s) => s.dy)).toEqual([0, 1, 0, 0]);
    const cutouts = evaluateFrame(spec([track({ kind: "float", axis: "x", target: { type: "role", role: "cutout" } } as Partial<Track> & { kind: "float" })]), 1, layout, true);
    expect(cutouts.shapes.map((s) => s.dx)).toEqual([0, 0, 0, 1]);
    // Without single-shape animation (too many shapes, or a weak device): left out.
    expect(evaluateFrame(spec([track({ kind: "float", axis: "x", target: { type: "shape", index: 0 } } as Partial<Track> & { kind: "float" })]), 1, layout, false).shapes).toEqual([]);
  });

  it("sparks are the same on every device", () => {
    expect(sparkLayout(12, 7)).toEqual(sparkLayout(12, 7));
    expect(sparkLayout(12, 7)).not.toEqual(sparkLayout(12, 8));
    expect(sparkLayout(99, 1)).toHaveLength(ANIMATION_LIMITS.sparksTotal);
  });

  it("features: single shapes only for logos with few shapes", () => {
    const s = spec([track({ kind: "rotate", target: { type: "shape", index: 0 } })]);
    expect(animationFeatures(s, 4).perShape).toBe(true);
    expect(animationFeatures(s, 30).perShape).toBe(false);
    expect(animationFeatures(STANDARD_ANIMATION, FLAME_LOGO_SPEC.shapes.length).perShape).toBe(false);
  });
});

describe("cost and device limits", () => {
  it("built-in presets stay below the warning", () => {
    for (const preset of BUILTIN_PRESETS) expect(animationCost(migrateV1(preset.params))).toBeLessThan(COST_LIMITS.soft);
  });

  it("too expensive is refused", () => {
    // Colour changes on every single shape, staggered: 4 x 24 shapes x 2 plus one layer per shape.
    const colors = Array.from({ length: 4 }, () =>
      track({ kind: "color", from: "accent", to: "neutral", stagger: { mode: "order", amount: 0.2, seed: 0 } } as Partial<Track> & { kind: "color" }),
    );
    const heavy = spec(colors);
    expect(animationCost(heavy)).toBeGreaterThan(COST_LIMITS.hard);
    expect(validateAnimationSpec(heavy)).toMatchObject({ ok: false, error: expect.stringMatching(/aufwendig/) });
  });

  it("weaker devices get less work, the course stays", () => {
    const sparks = track({ kind: "sparks", count: 30, seed: 1, size: 1, distance: 1 } as Partial<Track> & { kind: "sparks" });
    const s = { ...STANDARD_ANIMATION, tracks: [...STANDARD_ANIMATION.tracks, sparks] };
    const one = limitAnimation(s, 1);
    const two = limitAnimation(s, 2);
    expect(animationCost(one)).toBeLessThan(animationCost(s));
    expect(animationCost(two)).toBeLessThan(animationCost(one));
    for (const kind of ["draw", "fill", "exit", "breathe"] as const) {
      expect(two.tracks.filter((t) => t.kind === kind)).toEqual(s.tracks.filter((t) => t.kind === kind));
    }
    expect(two.tracks.some((t) => t.kind === "sparks" || t.kind === "shine")).toBe(false);
    expect(limitAnimation(s, 0)).toBe(s);
  });
});

describe("one source for dashboard and app", () => {
  it("both renderers take every frame from evaluateFrame / stillAnimFrame in shared/brand", () => {
    const read = (path: string) => readFileSync(join(__dirname, "../../..", path), "utf8");
    for (const file of ["admin-web/src/components/BrandLogo.tsx", "src/components/brand-animation/brand-animation.tsx"]) {
      const source = read(file);
      expect(source).toMatch(/evaluateFrame\(anim, /);
      expect(source).toMatch(/stillAnimFrame\(anim, /);
      expect(source).not.toMatch(/brandFrame\(|brandTimeline\(/);
    }
  });
});
