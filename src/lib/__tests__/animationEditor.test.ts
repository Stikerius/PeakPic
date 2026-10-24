import { describe, expect, it } from "@jest/globals";

import {
  HISTORY_LIMIT,
  MAX_IMPORT_BYTES,
  TEMPLATES,
  addKeyframe,
  addTrack,
  copyKeyframes,
  costRating,
  defaultTrack,
  deleteKeyframes,
  deleteTrack,
  duplicateTrack,
  exportAnimation,
  historyOf,
  importAnimation,
  mirrorTime,
  moveKeyframes,
  moveTrack,
  pasteKeyframes,
  pushHistory,
  randomize,
  redo,
  scaleTempo,
  setKeyframe,
  snapTime,
  soloSpec,
  staggerTrack,
  tidyKeyframes,
  trackLabel,
  undo,
} from "../../../admin-web/src/lib/animationEditor";
import {
  COST_LIMITS,
  EMPTY_LAYOUT,
  STANDARD_ANIMATION,
  TRACK_KINDS,
  evaluateFrame,
  keyframeValue,
  validateAnimationSpec,
  type AnimationSpec,
} from "../../../shared/brand/animation";

const valid = (spec: AnimationSpec) => {
  const checked = validateAnimationSpec(spec);
  if (!checked.ok) throw new Error(checked.error);
  return true;
};
const lin = { type: "preset" as const, name: "linear" as const };

describe("history", () => {
  it("undo and redo, at least 50 steps", () => {
    let h = historyOf(0);
    for (let i = 1; i <= 60; i += 1) h = pushHistory(h, i);
    for (let i = 0; i < 50; i += 1) h = undo(h);
    expect(h.present).toBe(10);
    h = redo(redo(h));
    expect(h.present).toBe(12);
    h = pushHistory(h, 99);
    expect(h.future).toEqual([]);
    let long = historyOf(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) long = pushHistory(long, i);
    expect(long.past).toHaveLength(HISTORY_LIMIT);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(50);
  });
});

describe("keyframes", () => {
  const spec: AnimationSpec = { version: 2, duration: 8, strokeWidth: 2, tracks: [{ ...defaultTrack("rotate"), keyframes: [{ t: 0.2, v: 0, ease: lin }, { t: 0.5, v: 90, ease: lin }, { t: 0.8, v: 0, ease: lin }] }] };

  it("snap to the grid and stay in the loop", () => {
    expect(snapTime(0.237, 0.05)).toBe(0.25);
    expect(snapTime(1.3, 0)).toBe(1);
    expect(snapTime(-0.2, 0.1)).toBe(0);
  });

  it("move several at once; order and gaps stay valid", () => {
    const moved = moveKeyframes(spec, [{ track: 0, key: 0 }, { track: 0, key: 1 }], 0.1);
    expect(moved.spec.tracks[0]?.keyframes.map((k) => k.t)).toEqual([0.3, 0.6, 0.8]);
    expect(moved.refs).toEqual([{ track: 0, key: 0 }, { track: 0, key: 1 }]);
    // Past the next one: the order changes and the moved one is found again.
    const past = moveKeyframes(spec, [{ track: 0, key: 0 }], 0.45);
    expect(past.spec.tracks[0]?.keyframes.map((k) => k.t)).toEqual([0.5, 0.65, 0.8]);
    expect(past.refs).toEqual([{ track: 0, key: 1 }]);
    const crowd = moveKeyframes(spec, [{ track: 0, key: 0 }, { track: 0, key: 1 }, { track: 0, key: 2 }], 5);
    expect(valid(crowd.spec)).toBe(true);
    expect(crowd.spec.tracks[0]?.keyframes.map((k) => k.t)).toEqual([0.998, 0.999, 1]);
  });

  it("values are clamped to the range of the kind", () => {
    expect(setKeyframe(spec, { track: 0, key: 1 }, { v: 999 }).tracks[0]?.keyframes[1]?.v).toBe(360);
  });

  it("add keeps the curve, never more than 12, never on top of another", () => {
    const added = addKeyframe(spec, 0, 0.35);
    expect(added?.spec.tracks[0]?.keyframes).toHaveLength(4);
    expect(added?.spec.tracks[0]?.keyframes[1]).toMatchObject({ t: 0.35, v: 45 });
    expect(addKeyframe(spec, 0, 0.5)).toBeNull();
    let full = spec;
    for (let i = 0; i < 20; i += 1) full = addKeyframe(full, 0, 0.01 + i * 0.01)?.spec ?? full;
    expect(full.tracks[0]?.keyframes).toHaveLength(12);
    expect(valid(full)).toBe(true);
  });

  it("delete keeps one keyframe per track", () => {
    expect(deleteKeyframes(spec, [{ track: 0, key: 0 }, { track: 0, key: 1 }, { track: 0, key: 2 }]).tracks[0]?.keyframes).toHaveLength(1);
  });

  it("copy and paste at another time", () => {
    const clip = copyKeyframes(spec, [{ track: 0, key: 1 }, { track: 0, key: 2 }]);
    expect(clip?.items.map((i) => i.dt)).toEqual([0, expect.closeTo(0.3)]);
    const pasted = pasteKeyframes(spec, clip ?? { items: [] }, 0, 0.1);
    expect(pasted.tracks[0]?.keyframes.map((k) => [k.t, k.v])).toEqual([[0.1, 90], [0.2, 0], [0.4, 0], [0.5, 90], [0.8, 0]]);
    expect(valid(pasted)).toBe(true);
  });

  it("tidy sorts and separates equal times", () => {
    expect(tidyKeyframes([{ t: 0.5, v: 0, ease: lin }, { t: 0.5, v: 1, ease: lin }, { t: 0.1, v: 2, ease: lin }]).map((k) => k.t)).toEqual([0.1, 0.5, 0.501]);
  });
});

describe("tracks", () => {
  it("every kind has a valid default track", () => {
    for (const kind of TRACK_KINDS) expect(valid({ version: 2, duration: 8, strokeWidth: 2, tracks: [defaultTrack(kind)] })).toBe(true);
  });

  it("add, duplicate, delete, reorder within the limits", () => {
    let spec = STANDARD_ANIMATION;
    spec = addTrack(spec, "rotate") ?? spec;
    expect(spec.tracks.at(-1)?.kind).toBe("rotate");
    expect(addTrack(spec, "dots")).toBeNull();
    const dup = duplicateTrack(spec, spec.tracks.length - 1);
    expect(dup?.tracks).toHaveLength(spec.tracks.length + 1);
    expect(duplicateTrack(spec, 0)).toBeNull(); // the dot raster exists once
    const moved = moveTrack(spec, spec.tracks.length - 1, 0);
    expect(moved.tracks[0]?.kind).toBe("rotate");
    expect(deleteTrack({ ...spec, tracks: spec.tracks.slice(0, 1) }, 0).tracks).toHaveLength(1);
    let full = spec;
    for (let i = 0; i < 20; i += 1) full = addTrack(full, "float") ?? full;
    expect(full.tracks).toHaveLength(16);
  });

  it("solo switches the others off in the preview only", () => {
    const solo = soloSpec(STANDARD_ANIMATION, 2);
    expect(solo.tracks.filter((t) => t.enabled)).toHaveLength(1);
    expect(soloSpec(STANDARD_ANIMATION, null)).toBe(STANDARD_ANIMATION);
  });

  it("labels say everything without colour", () => {
    const track = { ...defaultTrack("fill"), enabled: false, target: { type: "shape" as const, index: 1 }, stagger: { mode: "order" as const, amount: 0.2, seed: 0 }, repeat: 2 };
    expect(trackLabel(track, 1)).toBe("Spur 2: Füllen, Form 2, gestaffelt in reihenfolge, 2-mal, stumm");
  });
});

describe("tools", () => {
  const fill = { version: 2 as const, duration: 8, strokeWidth: 2, tracks: [defaultTrack("fill")] };

  it("stagger within 0..0.5, never on global kinds", () => {
    expect(staggerTrack(fill, 0, { mode: "center", amount: 0.9, seed: 3 }).tracks[0]?.stagger).toEqual({ mode: "center", amount: 0.5, seed: 3 });
    const wave = { ...fill, tracks: [defaultTrack("wave")] };
    expect(staggerTrack(wave, 0, { mode: "order", amount: 0.2, seed: 0 })).toBe(wave);
  });

  it("random variation stays valid and is repeatable", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const varied = randomize(STANDARD_ANIMATION, null, seed, 0.2);
      expect(valid(varied)).toBe(true);
      expect(varied).toEqual(randomize(STANDARD_ANIMATION, null, seed, 0.2));
    }
    expect(randomize(STANDARD_ANIMATION, null, 1)).not.toEqual(STANDARD_ANIMATION);
  });

  it("mirror in time: the value at t becomes the value at 1 - t", () => {
    const spec: AnimationSpec = {
      version: 2,
      duration: 8,
      strokeWidth: 2,
      tracks: [{ ...defaultTrack("rotate"), keyframes: [{ t: 0.1, v: 0, ease: { type: "preset", name: "easeIn" } }, { t: 0.4, v: 90, ease: { type: "bezier", x1: 0.2, y1: 0, x2: 0.4, y2: 1 } }, { t: 0.9, v: 30, ease: lin }] }],
    };
    const mirrored = mirrorTime(spec, 0);
    expect(valid(mirrored)).toBe(true);
    const before = spec.tracks[0]?.keyframes ?? [];
    const after = mirrored.tracks[0]?.keyframes ?? [];
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(keyframeValue(after, 1 - t)).toBeCloseTo(keyframeValue(before, t), 4);
    }
    expect(mirrorTime(mirrored, 0)).toEqual(spec);
  });

  it("tempo scale keeps the start and the loop", () => {
    const spec = scaleTempo(fill, 0, 2);
    expect(spec.tracks[0]?.keyframes.map((k) => k.t)).toEqual([0.25, expect.closeTo(0.59)]);
    expect(valid(scaleTempo(STANDARD_ANIMATION, null, 4))).toBe(true);
    expect(valid(scaleTempo(STANDARD_ANIMATION, null, 0.25))).toBe(true);
  });
});

describe("templates", () => {
  it("the four built-in presets and four more, all valid and below the warning", () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(["Standard", "Ruhig", "Lebendig", "Nur Zeichnen", "Pulsieren", "Funkeln", "Wellenstart", "Zeichnen und Drehen"]);
    for (const t of TEMPLATES) {
      expect(valid(t.spec)).toBe(true);
      expect(costRating(t.spec, 4).level).toBe("ok");
      // Each template draws something visible in the middle of its loop.
      const frame = evaluateFrame(t.spec, 0.6, EMPTY_LAYOUT, false);
      expect(frame.fillOpacity + frame.strokeOpacity).toBeGreaterThan(0);
    }
  });
});

describe("import and export", () => {
  it("round trip", () => {
    const text = exportAnimation("Meine Animation", STANDARD_ANIMATION);
    expect(importAnimation(text, text.length)).toEqual({ ok: true, name: "Meine Animation", spec: STANDARD_ANIMATION });
    expect(importAnimation(JSON.stringify(STANDARD_ANIMATION), 100)).toMatchObject({ ok: true, name: "Importierte Animation" });
  });

  it("checked like an upload", () => {
    expect(importAnimation("{}", MAX_IMPORT_BYTES + 1)).toMatchObject({ ok: false, error: expect.stringMatching(/64 KB/) });
    expect(importAnimation("<svg onload=alert(1)>", 30)).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    const manipulated = JSON.stringify({ format: "peakpic-animation", name: "x", animation: { ...STANDARD_ANIMATION, duration: 1000 } });
    expect(importAnimation(manipulated, manipulated.length)).toMatchObject({ ok: false, error: expect.stringMatching(/Regeln/) });
    const extra = JSON.stringify({ ...STANDARD_ANIMATION, tracks: [{ ...STANDARD_ANIMATION.tracks[0], script: "x" }] });
    expect(importAnimation(extra, extra.length).ok).toBe(false);
  });

  it("cost rating", () => {
    expect(costRating(STANDARD_ANIMATION, 4)).toMatchObject({ level: "ok" });
    expect(COST_LIMITS.soft).toBeLessThan(COST_LIMITS.hard);
  });
});
