import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_APPEARANCE,
  STYLES,
  parseAppearance,
  resolveMode,
  serializeAppearance,
  type Appearance,
} from "../../../admin-web/src/lib/appearance";
import { AMBIENT_MAX_OPACITY, blend, contrast, tokensFor, type TokenName } from "../../../admin-web/src/lib/tokens";
import { BUILTIN_COLOR_SETS, DEFAULT_COLOR_SET } from "../../../shared/brand/colors";

const MODES = ["light", "dark"] as const;
const PALETTES = ["color", "bw"] as const;
const combos = STYLES.flatMap((s) => MODES.flatMap((m) => PALETTES.map((p) => [s.id, m, p] as const)));
/** Every style, mode and built-in colour set with the palette "Hauptfarbe". */
const colorCombos = STYLES.flatMap((s) => MODES.flatMap((m) => BUILTIN_COLOR_SETS.map((c) => [s.id, m, c.name] as const)));
const setNamed = (name: string) => BUILTIN_COLOR_SETS.find((c) => c.name === name) ?? DEFAULT_COLOR_SET;

describe("appearance choice (stored per browser)", () => {
  it("defaults: Neu, System, Schwarz-Weiss, animations on", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ style: "new", mode: "system", palette: "bw", ambient: "on" });
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("stores and reads back every combination", () => {
    for (const [style, mode, palette] of combos) {
      for (const ambient of ["on", "calm", "off"] as const) {
        const a: Appearance = { style, mode, palette, ambient };
        expect(parseAppearance(serializeAppearance(a))).toEqual(a);
      }
    }
  });

  it("falls back per value when something is missing or broken", () => {
    expect(parseAppearance("{nicht json")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("[]")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(JSON.stringify({ style: "retro", mode: "dark", palette: "neon" }))).toEqual({
      ...DEFAULT_APPEARANCE,
      mode: "dark",
    });
    expect(parseAppearance(JSON.stringify({ palette: "color" }))).toEqual({ ...DEFAULT_APPEARANCE, palette: "color" });
  });

  it("takes over the old light/dark choice", () => {
    expect(parseAppearance(null, "dark").mode).toBe("dark");
    expect(parseAppearance(null, "purple").mode).toBe("system");
    expect(parseAppearance(JSON.stringify({ mode: "light" }), "dark").mode).toBe("light");
  });

  it("resolves System to the system's mode", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });
});

describe("tokens", () => {
  it("every combination defines every token", () => {
    const names = Object.keys(tokensFor("new", "dark", "bw")).sort();
    for (const [s, m, p] of combos) expect(Object.keys(tokensFor(s, m, p)).sort()).toEqual(names);
  });

  it("the palette changes the accent, the style the neutrals", () => {
    expect(tokensFor("new", "dark", "color").accent).toBe("#ff5a36");
    expect(tokensFor("new", "light", "color").accent).toBe("#f2481f");
    expect(tokensFor("new", "dark", "bw").accent).toBe("#fafafa");
    expect(tokensFor("new", "light", "bw")["on-accent"]).toBe("#ffffff");
    expect(tokensFor("new", "dark", "bw").bg).toBe("#09090b");
    expect(tokensFor("new", "light", "bw").bg).toBe("#f7f7f5");
    expect(tokensFor("classic", "dark", "bw").bg).not.toBe(tokensFor("new", "dark", "bw").bg);
  });

  const hex = (t: Record<TokenName, string>, name: TokenName) => t[name];
  type Check = [TokenName, TokenName, number];
  const CHECKS: Check[] = [
    ...(["text", "text-2", "text-3"] as const).flatMap((fg): Check[] =>
      (["bg", "surface", "raised", "row-hover"] as const).map((bg): Check => [fg, bg, 4.5]),
    ),
    ["text", "accent-soft", 4.5],
    ["text", "diff-added", 4.5],
    ["text", "diff-removed", 4.5],
    ["danger", "surface", 4.5],
    ["danger", "bg", 4.5],
    ["success", "surface", 4.5],
    ["success", "bg", 4.5],
    ["warn-text", "warn-bg", 4.5],
    ["on-accent", "accent", 4.5],
    // Non-text: controls and focus rings need 3:1 against what they sit on.
    ["accent", "bg", 3],
    ["accent", "surface", 3],
    ["focus", "bg", 3],
    ["focus", "surface", 3],
  ];

  it.each(combos)("WCAG AA in %s / %s / %s", (s, m, p) => {
    const t = tokensFor(s, m, p);
    for (const [fg, bg, min] of CHECKS) {
      const ratio = contrast(hex(t, fg), hex(t, bg));
      if (ratio < min) throw new Error(`${s}/${m}/${p}: ${fg} on ${bg} = ${ratio.toFixed(2)} (< ${min})`);
    }
  });

  it.each(colorCombos)("WCAG AA with the colour set in %s / %s / %s", (s, m, name) => {
    const t = tokensFor(s, m, "color", setNamed(name));
    const checks: Check[] = [...CHECKS, ["accent-text", "bg", 4.5], ["accent-text", "surface", 4.5]];
    for (let i = 1; i <= 8; i += 1) checks.push([`chart-${i}` as TokenName, "surface", 3], [`chart-${i}` as TokenName, "bg", 3]);
    for (const [fg, bg, min] of checks) {
      const ratio = contrast(hex(t, fg), hex(t, bg));
      if (ratio < min) throw new Error(`${s}/${m}/${name}: ${fg} on ${bg} = ${ratio.toFixed(2)} (< ${min})`);
    }
  });
});

describe("background animations never cost contrast", () => {
  it.each(combos)("text on the page background stays AA under a line at full ambient opacity (%s / %s / %s)", (s, m, p) => {
    const t = tokensFor(s, m, p);
    for (const line of ["ambient-line", "ambient-alert"] as const) {
      const worst = blend(t.bg, t[line], AMBIENT_MAX_OPACITY);
      for (const fg of ["text", "text-2", "text-3", "danger", "success"] as const) {
        const ratio = contrast(t[fg], worst);
        if (ratio < 4.5) throw new Error(`${s}/${m}/${p}: ${fg} over ${line} = ${ratio.toFixed(2)}`);
      }
    }
  });

  it("styles.css never gives the ambient layer more opacity than allowed", () => {
    const css = readFileSync(join(__dirname, "../../../admin-web/src/styles.css"), "utf8");
    const values = [...css.matchAll(/--ambient-opacity:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).toBeLessThanOrEqual(AMBIENT_MAX_OPACITY);
  });
});

describe("no colours outside the tokens", () => {
  it("styles.css uses only var(--…)", () => {
    const css = readFileSync(join(__dirname, "../../../admin-web/src/styles.css"), "utf8");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)).toBeNull();
  });
});
