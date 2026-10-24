import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  APP_LOGO_SPEC,
  BUILTIN_LOGOS,
  BUILTIN_PRESETS,
  DEFAULT_DESIGN_CONFIG,
  FLAME_LOGO_SPEC,
  LOGO_LIMITS,
  STANDARD_PARAMS,
  brandColors,
  brandFrame,
  brandTimeline,
  cubicBezier,
  parsePathData,
  parsePublicDesignConfig,
  pathLength,
  resolveDesignConfig,
  serializeDesignConfig,
  shapeLength,
  shineGeometry,
  shineX,
  stillFrame,
  validateLogoSpec,
  validatePresetParams,
} from "../../../shared/brand";

const standard = brandTimeline(STANDARD_PARAMS);
const at = (p: number) => brandFrame(p, STANDARD_PARAMS, standard);
const close = (a: number, b: number, digits = 4) => expect(a).toBeCloseTo(b, digits);

describe("standard timeline (approved, must not change)", () => {
  it("has exactly the agreed phases", () => {
    expect(standard).toEqual({
      drawEnd: 0.3,
      fillStart: 0.25,
      fillEnd: 0.42,
      strokeOutStart: 0.36,
      strokeOutEnd: 0.48,
      waveStart: 0.4,
      wavePeak: 0.42,
      waveEnd: 0.62,
      shineStart: 0.42,
      shineEnd: 0.62,
      breatheStart: 0.5,
      breathePeak: 0.65,
      breatheEnd: 0.8,
      exitStart: 0.82,
      exitEnd: 0.95,
    });
    expect(STANDARD_PARAMS.duration).toBe(8);
  });

  it("at 0: nothing drawn yet, logo visible", () => {
    const f = at(0);
    expect(f.strokeOffset).toBe(1);
    expect(f.strokeOpacity).toBe(1);
    expect(f.fillOpacity).toBe(0);
    expect(f.waveOpacity).toBe(0);
    expect(f.logoOpacity).toBe(1);
    expect(f.logoScale).toBe(1);
  });

  it("at 0.3: outline complete, fill under way", () => {
    const f = at(0.3);
    expect(f.strokeOffset).toBe(0);
    expect(f.strokeOpacity).toBe(1);
    expect(f.fillOpacity).toBeGreaterThan(0);
    expect(f.fillOpacity).toBeLessThan(1);
    close(f.fillScale, 0.97 + 0.03 * cubicBezier(0, 0, 0.58, 1, 0.05 / 0.17));
  });

  it("at 0.42: fill complete, outline half gone, wave at its peak, shine starts", () => {
    const f = at(0.42);
    expect(f.fillOpacity).toBe(1);
    expect(f.fillScale).toBe(1);
    close(f.strokeOpacity, 0.5);
    close(f.waveOpacity, 0.95);
    close(f.waveScale, 0.15 + 5.85 * cubicBezier(0.2, 0.6, 0.3, 1, 0.02 / 0.22));
    expect(f.shine).toBe(0);
    expect(f.shineOpacity).toBe(0.55);
  });

  it("at 0.62: wave gone at full size, shine across, breathing", () => {
    const f = at(0.62);
    close(f.waveOpacity, 0);
    close(f.waveScale, 6);
    close(f.shine, 1);
    expect(f.strokeOpacity).toBe(0);
    expect(f.logoScale).toBeGreaterThan(1);
    expect(f.logoScale).toBeLessThan(1.02);
  });

  it("breathes to 1.02 at 65 % and back to 1 at 80 %", () => {
    close(at(0.65).logoScale, 1.02);
    close(at(0.8).logoScale, 1);
  });

  it("at 0.82: still fully visible; at 0.95 gone; pause until 1", () => {
    expect(at(0.82).logoOpacity).toBe(1);
    close(at(0.95).logoOpacity, 0);
    expect(at(0.97).logoOpacity).toBe(0);
    expect(at(1).logoOpacity).toBe(0);
  });

  it("the outline is drawn with cubic-bezier(0.45,0,0.2,1)", () => {
    close(1 - at(0.15).strokeOffset, cubicBezier(0.45, 0, 0.2, 1, 0.5));
  });

  it("still image: finished logo, no wave, no shine", () => {
    expect(stillFrame(STANDARD_PARAMS)).toMatchObject({ fillOpacity: 1, strokeOpacity: 0, waveOpacity: 0, shineOpacity: 0, logoOpacity: 1 });
    const drawOnly = BUILTIN_PRESETS.find((p) => p.name === "Nur Zeichnen")?.params ?? STANDARD_PARAMS;
    expect(stillFrame(drawOnly)).toMatchObject({ fillOpacity: 0, strokeOpacity: 1 });
  });
});

describe("other parameters", () => {
  it("long loops are compressed so they end by 95 %", () => {
    const t = brandTimeline({ ...STANDARD_PARAMS, drawPortion: 0.5, hold: 0.4 });
    close(t.exitEnd, 0.95);
    expect(t.drawEnd).toBeLessThan(0.5);
    expect(t.breatheEnd).toBeGreaterThan(t.breatheStart);
  });

  it("phases move with the draw share", () => {
    const t = brandTimeline({ ...STANDARD_PARAMS, drawPortion: 0.2 });
    close(t.fillStart, 0.15);
    close(t.waveStart, 0.3);
    close(t.exitStart, 0.72);
  });

  it("without wave, shine and breathing nothing moves there", () => {
    const params = { ...STANDARD_PARAMS, wave: false, shine: false, breathe: false };
    const f = brandFrame(0.5, params, brandTimeline(params));
    expect(f.waveOpacity).toBe(0);
    expect(f.shineOpacity).toBe(0);
    expect(f.logoScale).toBe(1);
  });

  it("'Nur Zeichnen' keeps the outline and never fills", () => {
    const params = BUILTIN_PRESETS[3]?.params ?? STANDARD_PARAMS;
    const f = brandFrame(0.7, params, brandTimeline(params));
    expect(f.fillOpacity).toBe(0);
    expect(f.strokeOpacity).toBe(1);
    expect(f.strokeOffset).toBe(0);
  });

  it("wipes uncover the fill, shrink makes the logo smaller", () => {
    const wipe = { ...STANDARD_PARAMS, fillMode: "wipeUp" as const };
    const w = brandFrame(0.3, wipe, brandTimeline(wipe));
    expect(w.fillReveal).toBeGreaterThan(0);
    expect(w.fillReveal).toBeLessThan(1);
    const shrink = { ...STANDARD_PARAMS, exit: "shrink" as const };
    expect(brandFrame(0.9, shrink, brandTimeline(shrink)).logoScale).toBeLessThan(1);
    const none = { ...STANDARD_PARAMS, exit: "none" as const };
    expect(brandFrame(0.97, none, brandTimeline(none)).logoOpacity).toBe(1);
  });
});

describe("presets", () => {
  it("built-in presets are valid", () => {
    for (const preset of BUILTIN_PRESETS) expect(validatePresetParams(preset.params).ok).toBe(true);
  });

  it("rejects values out of range, unknown keys and wrong types", () => {
    expect(validatePresetParams({ ...STANDARD_PARAMS, duration: 3 }).ok).toBe(false);
    expect(validatePresetParams({ ...STANDARD_PARAMS, duration: 17 }).ok).toBe(false);
    expect(validatePresetParams({ ...STANDARD_PARAMS, waveScale: Number.NaN }).ok).toBe(false);
    expect(validatePresetParams({ ...STANDARD_PARAMS, shineAngle: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(validatePresetParams({ ...STANDARD_PARAMS, fillMode: "explode" }).ok).toBe(false);
    expect(validatePresetParams({ ...STANDARD_PARAMS, wave: "yes" }).ok).toBe(false);
    expect(validatePresetParams({ ...STANDARD_PARAMS, extra: 1 }).ok).toBe(false);
    const { hold: _hold, ...missing } = STANDARD_PARAMS;
    expect(validatePresetParams(missing).ok).toBe(false);
    expect(validatePresetParams(null).ok).toBe(false);
  });
});

describe("logo spec", () => {
  it("built-in logos are valid", () => {
    expect(validateLogoSpec(APP_LOGO_SPEC).ok).toBe(true);
    expect(validateLogoSpec(FLAME_LOGO_SPEC).ok).toBe(true);
  });

  it("the app logo is the shape of the app icon", () => {
    const svg = readFileSync(join(__dirname, "../../../assets/peakpic-icons/svg-quellen/default_bw.svg"), "utf8");
    const path = APP_LOGO_SPEC.shapes[0];
    expect(path?.type === "path" && svg.includes(`d="${path.d}"`)).toBe(true);
    expect(svg).toContain('<circle cx="252" cy="258" r="34"');
    expect(svg).toContain('<rect x="242" y="218" width="20" height="10" rx="4"');
    expect(svg).toContain('<circle cx="252" cy="258" r="18" fill="#000000"');
  });

  const base = { version: 1, viewBox: [0, 0, 100, 100], shapes: [{ type: "circle", cx: 50, cy: 50, r: 20, role: "fill", transform: [1, 0, 0, 1, 0, 0] }] };
  const withShape = (shape: Record<string, unknown>) => ({ ...base, shapes: [{ ...base.shapes[0], ...shape }] });

  it("accepts all shape types", () => {
    const shapes = [
      { type: "path", d: "M0 0L10 10H5V2C1 2 3 4 5 6S7 8 9 9Q1 1 2 2T3 3A5 5 0 0 1 10 10Z", role: "fill", transform: [1, 0, 0, 1, 0, 0] },
      { type: "ellipse", cx: 1, cy: 1, rx: 2, ry: 3, role: "stroke", strokeWidth: 2, transform: [2, 0, 0, 2, 5, 5] },
      { type: "rect", x: 0, y: 0, width: 5, height: 5, rx: 0, ry: 0, role: "cutout", transform: [1, 0, 0, 1, 0, 0] },
      { type: "line", x1: 0, y1: 0, x2: 5, y2: 5, role: "stroke", transform: [1, 0, 0, 1, 0, 0] },
      { type: "polygon", points: [0, 0, 5, 0, 5, 5], role: "fill", transform: [1, 0, 0, 1, 0, 0] },
      { type: "polyline", points: [0, 0, 5, 0], role: "stroke", transform: [1, 0, 0, 1, 0, 0] },
    ];
    expect(validateLogoSpec({ ...base, shapes }).ok).toBe(true);
  });

  it("rejects manipulated structures", () => {
    expect(validateLogoSpec(withShape({ type: "text" })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ type: "image" })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ href: "javascript:alert(1)" })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ style: "fill:url(#x)" })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ r: Number.NaN })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ r: 1e9 })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ r: -1 })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ role: "glow" })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ transform: [1, 0, 0, 1, 0] })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ transform: [1e6, 0, 0, 1, 0, 0] })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ transform: [0, 0, 0, 0, 0, 0] })).ok).toBe(false);
    expect(validateLogoSpec(withShape({ role: "cutout" })).ok).toBe(false);
    expect(validateLogoSpec({ ...base, version: 2 }).ok).toBe(false);
    expect(validateLogoSpec({ ...base, viewBox: [0, 0, 0, 10] }).ok).toBe(false);
    expect(validateLogoSpec({ ...base, filter: "blur" }).ok).toBe(false);
    expect(validateLogoSpec({ ...base, shapes: [] }).ok).toBe(false);
    expect(validateLogoSpec({ ...base, shapes: Array.from({ length: 101 }, () => base.shapes[0]) }).ok).toBe(false);
  });

  it("checks path data against the allowed characters and limits", () => {
    const path = (d: string) => validateLogoSpec(withShape({ type: "path", d, cx: undefined, cy: undefined, r: undefined }));
    const pathShape = (d: string) => validateLogoSpec({ ...base, shapes: [{ type: "path", d, role: "fill", transform: [1, 0, 0, 1, 0, 0] }] });
    expect(pathShape("M0 0L10 10Z").ok).toBe(true);
    expect(pathShape("M0 0L10 10url(#a)").ok).toBe(false);
    expect(pathShape("L10 10").ok).toBe(false);
    expect(pathShape("M0 0L10").ok).toBe(false);
    expect(pathShape("M0 0L1e999 0").ok).toBe(false);
    expect(pathShape("M0 0L+5 0").ok).toBe(false);
    expect(pathShape(`M0 0${"L1 1".repeat(4001)}`).ok).toBe(false);
    expect(pathShape(`M0 0 ${"1 ".repeat(LOGO_LIMITS.maxPathChars)}`).ok).toBe(false);
    expect(path("M0 0").ok).toBe(false);
    expect(parsePathData("M0,0 l10-5z")?.map((c) => c.command)).toEqual(["M", "l", "z"]);
  });

  it("measures outlines for drawing", () => {
    expect(pathLength("M0 0L30 40")).toBeCloseTo(50);
    expect(pathLength("M0 0H10V10H0Z")).toBeCloseTo(40);
    expect(pathLength("M0 0 10 0 10 10")).toBeCloseTo(20);
    expect(pathLength("M0 0A10 10 0 0 1 20 0")).toBeCloseTo(Math.PI * 10, 0);
    expect(shapeLength({ type: "circle", cx: 0, cy: 0, r: 10, role: "fill", transform: [2, 0, 0, 2, 0, 0] })).toBeCloseTo(40 * Math.PI);
    for (const logo of BUILTIN_LOGOS) for (const shape of logo.spec.shapes) expect(shapeLength(shape)).toBeGreaterThan(1);
  });
});

describe("design config and fallback", () => {
  const remote = { palette: "color", mode: "dark", animation: "off", logo: FLAME_LOGO_SPEC, preset: BUILTIN_PRESETS[1]?.params };

  it("reads a valid answer", () => {
    expect(parsePublicDesignConfig(remote)).toEqual({
      palette: "color",
      mode: "dark",
      animation: false,
      logo: FLAME_LOGO_SPEC,
      preset: BUILTIN_PRESETS[1]?.params,
    });
  });

  it("a broken logo or preset falls back to the app logo / standard", () => {
    const parsed = parsePublicDesignConfig({ ...remote, logo: { version: 1, shapes: "<script>" }, preset: { duration: 99 } });
    expect(parsed?.logo).toEqual(APP_LOGO_SPEC);
    expect(parsed?.preset).toEqual(STANDARD_PARAMS);
  });

  it("an unknown palette, mode or switch, or a huge answer is not trusted at all", () => {
    expect(parsePublicDesignConfig({ ...remote, palette: "neon" })).toBeNull();
    expect(parsePublicDesignConfig({ ...remote, mode: "auto" })).toBeNull();
    expect(parsePublicDesignConfig({ ...remote, animation: true })).toBeNull();
    expect(parsePublicDesignConfig({ ...remote, padding: "x".repeat(400_000) })).toBeNull();
    expect(parsePublicDesignConfig("bw")).toBeNull();
  });

  it("falls back to the last good copy, then to the defaults", () => {
    const cached = parsePublicDesignConfig(JSON.parse(serializeDesignConfig(parsePublicDesignConfig(remote) ?? DEFAULT_DESIGN_CONFIG)));
    expect(resolveDesignConfig(null, cached)).toEqual(cached);
    expect(resolveDesignConfig(null, null)).toEqual(DEFAULT_DESIGN_CONFIG);
    expect(DEFAULT_DESIGN_CONFIG).toMatchObject({ palette: "bw", mode: "system", animation: true, logo: APP_LOGO_SPEC });
  });
});

describe("palettes", () => {
  it("has the agreed colours", () => {
    expect(brandColors("color", "dark")).toMatchObject({ accent: "#ff5a36", background: "#09090b", mutedDot: "#3a3a40" });
    expect(brandColors("color", "light")).toMatchObject({ accent: "#f2481f", background: "#f7f7f5", mutedDot: "#cfcfc8" });
    expect(brandColors("bw", "dark")).toMatchObject({ accent: "#fafafa", onAccent: "#1b0f0a" });
    expect(brandColors("bw", "light")).toMatchObject({ accent: "#18181b", onAccent: "#ffffff" });
  });
});

describe("seeds in schema.sql match the shared values", () => {
  const schema = readFileSync(join(__dirname, "../../../supabase/schema.sql"), "utf8");
  const seed = (marker: string): unknown => {
    const match = new RegExp(`-- brand-seed:${marker}\\n\\s*'([^']+)'`).exec(schema);
    return match?.[1] !== undefined ? JSON.parse(match[1]) : null;
  };

  it("presets", () => {
    for (const preset of BUILTIN_PRESETS) expect(seed(preset.id)).toEqual(preset.params);
  });

  it("logos", () => {
    for (const logo of BUILTIN_LOGOS) expect(seed(logo.id)).toEqual(JSON.parse(JSON.stringify(logo.spec)));
  });
});

describe("shine strip", () => {
  // Corners of the viewBox seen in the frame of the strip (the strip is rotated by angle around the centre).
  function cornersInStripFrame(vb: [number, number, number, number], angle: number) {
    const [x, y, w, h] = vb;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const a = (angle * Math.PI) / 180;
    return [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].map(([px = 0, py = 0]) => [
      cx + (px - cx) * Math.cos(a) + (py - cy) * Math.sin(a),
      cy - (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a),
    ]);
  }

  const cases: [[number, number, number, number], number, number][] = [
    [[131, 92, 167, 212], 12, 70],
    [[0, 0, 200, 240], -30, 120],
    [[0, 0, 500, 100], 30, 20],
    [[-50, -50, 100, 400], 0, 50],
  ];
  it.each(cases)("never touches the logo before and after its pass (viewBox %j, %d°)", (viewBox, angle, width) => {
    const vb = viewBox;
    const g = shineGeometry(vb, width, angle);
    const corners = cornersInStripFrame(vb, angle);
    const xs = corners.map(([cx]) => cx ?? 0);
    const ys = corners.map(([, cy]) => cy ?? 0);
    // Start: the whole box is right of the strip; end: the whole box is left of it.
    expect(Math.min(...xs)).toBeGreaterThan(shineX(g, 0) + width);
    expect(Math.max(...xs)).toBeLessThan(shineX(g, 1));
    // Tall enough to cover the box during the pass.
    expect(Math.min(...ys)).toBeGreaterThan(g.y);
    expect(Math.max(...ys)).toBeLessThan(g.y + g.height);
  });
});
