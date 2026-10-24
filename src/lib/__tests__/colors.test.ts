import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  BUILTIN_COLOR_SETS,
  DEFAULT_COLOR_SET,
  MAX_CHART_COLORS,
  ON_ACCENT_DARK,
  ON_ACCENT_LIGHT,
  REFERENCE_BACKGROUNDS,
  accentTextColor,
  chartColorsOf,
  colorSetProblem,
  contrastRatio,
  deriveChartColors,
  ensureAccessible,
  minContrast,
  onAccentColor,
  parseColorSet,
} from "../../../shared/brand/colors";
import { DEFAULT_DESIGN_CONFIG, parsePublicDesignConfig } from "../../../shared/brand/config";
import { brandColors } from "../../../shared/brand/palettes";

const ALL = [...REFERENCE_BACKGROUNDS.dark, ...REFERENCE_BACKGROUNDS.light];
const set = (accentDark: string, accentLight: string, chartColors: string[] | null = null) => ({ accentDark, accentLight, chartColors });

describe("contrast", () => {
  it("matches WCAG for black and white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#ff5a36", "#09090b")).toBeCloseTo(contrastRatio("#09090b", "#ff5a36"));
  });

  it("text on accent: the better of #1b0f0a and #ffffff, ties go to the dark one", () => {
    expect(onAccentColor("#ff5a36")).toBe(ON_ACCENT_DARK);
    expect(onAccentColor("#1f6fd6")).toBe(ON_ACCENT_LIGHT);
    expect(onAccentColor("#fafafa")).toBe(ON_ACCENT_DARK);
    expect(onAccentColor("#18181b")).toBe(ON_ACCENT_LIGHT);
  });

  it("ensureAccessible keeps good colours and fixes bad ones", () => {
    expect(ensureAccessible("#ff5a36", REFERENCE_BACKGROUNDS.dark, 3)).toBe("#ff5a36");
    const fixed = ensureAccessible("#ffd0c0", REFERENCE_BACKGROUNDS.light, 3);
    expect(minContrast(fixed, REFERENCE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(3);
    const lifted = ensureAccessible("#300a05", REFERENCE_BACKGROUNDS.dark, 3);
    expect(minContrast(lifted, REFERENCE_BACKGROUNDS.dark)).toBeGreaterThanOrEqual(3);
  });

  it("accent as text reaches 4.5:1", () => {
    for (const s of BUILTIN_COLOR_SETS) {
      expect(minContrast(accentTextColor(s.accentLight, "light"), REFERENCE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(4.5);
      expect(minContrast(accentTextColor(s.accentDark, "dark"), REFERENCE_BACKGROUNDS.dark)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("colour sets", () => {
  it("built-in sets pass every rule; Orange is the default with the old values", () => {
    expect(BUILTIN_COLOR_SETS.map((s) => s.name)).toEqual(["Orange", "Blau", "Grün", "Violett", "Rot"]);
    for (const s of BUILTIN_COLOR_SETS) expect(colorSetProblem(s)).toBeNull();
    expect(DEFAULT_COLOR_SET).toMatchObject({ name: "Orange", accentDark: "#ff5a36", accentLight: "#f2481f" });
    expect(brandColors("color", "dark")).toMatchObject({ accent: "#ff5a36", onAccent: "#1b0f0a" });
    expect(brandColors("color", "light")).toMatchObject({ accent: "#f2481f", onAccent: "#1b0f0a" });
  });

  it("black and white stays independent of the colour set", () => {
    const blue = BUILTIN_COLOR_SETS[1] ?? DEFAULT_COLOR_SET;
    expect(brandColors("bw", "dark", blue)).toEqual(brandColors("bw", "dark"));
    expect(brandColors("color", "light", blue).accent).toBe("#1f6fd6");
    expect(brandColors("color", "light", blue).onAccent).toBe("#ffffff");
  });

  it("refuses unreadable and malformed colours, with a suggestion that passes", () => {
    expect(colorSetProblem(set("ff5a36", "#f2481f"))?.code).toBe("invalid_hex");
    expect(colorSetProblem(set("#ff5a3", "#f2481f"))?.code).toBe("invalid_hex");
    expect(colorSetProblem(set("#ff5a36", "url(#x)"))?.code).toBe("invalid_hex");
    const darkProblem = colorSetProblem(set("#202024", "#f2481f"));
    expect(darkProblem?.code).toBe("accent_dark_contrast");
    expect(colorSetProblem(set(darkProblem?.suggestion?.accentDark ?? "", "#f2481f"))).toBeNull();
    const lightProblem = colorSetProblem(set("#ff5a36", "#ffe0d0"));
    expect(lightProblem?.code).toBe("accent_light_contrast");
    expect(minContrast(lightProblem?.suggestion?.accentLight ?? "", REFERENCE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(3);
  });

  it("refuses an accent where no text colour reaches 4.5:1", () => {
    // Mid grey: stands out from the dark background (about 4:1), but neither dark nor white text
    // reaches 4.5:1 on it.
    const problem = colorSetProblem(set("#7a7a7a", "#f2481f"));
    expect(problem?.code).toBe("on_accent_dark");
    expect(colorSetProblem(set(problem?.suggestion?.accentDark ?? "", "#f2481f"))).toBeNull();
  });

  it("chart colours: at most 8, valid and readable on both modes", () => {
    expect(colorSetProblem(set("#ff5a36", "#f2481f", Array.from({ length: 9 }, () => "#1f6fd6")))?.code).toBe("invalid_chart");
    expect(colorSetProblem(set("#ff5a36", "#f2481f", ["#zzzzzz"]))?.code).toBe("invalid_chart");
    expect(colorSetProblem(set("#ff5a36", "#f2481f", ["#fafafa"]))?.code).toBe("chart_contrast");
    expect(colorSetProblem(set("#ff5a36", "#f2481f", ["#1f6fd6", "#d94626"]))).toBeNull();
  });

  it("derived chart colours are distinct and readable on both modes", () => {
    for (const s of BUILTIN_COLOR_SETS) {
      const colors = deriveChartColors(s.accentDark);
      expect(colors).toHaveLength(MAX_CHART_COLORS);
      expect(new Set(colors).size).toBe(MAX_CHART_COLORS);
      for (const c of colors) expect(minContrast(c, ALL)).toBeGreaterThanOrEqual(3);
      expect(chartColorsOf(s)).toEqual(colors);
    }
  });
});

describe("public answer and fallback", () => {
  it("reads a valid set and refuses broken ones", () => {
    expect(parseColorSet({ name: "Blau", accent_dark: "#4D9FFF", accent_light: "#1f6fd6", chart_colors: null })).toEqual({
      name: "Blau",
      accentDark: "#4d9fff",
      accentLight: "#1f6fd6",
      chartColors: null,
    });
    expect(parseColorSet({ name: "X", accent_dark: "#202024", accent_light: "#1f6fd6" })).toBeNull();
    expect(parseColorSet({ name: "", accent_dark: "#4d9fff", accent_light: "#1f6fd6" })).toBeNull();
    expect(parseColorSet({ name: "X", accent_dark: "#4d9fff", accent_light: "#1f6fd6", chart_colors: "rot" })).toBeNull();
    expect(parseColorSet("orange")).toBeNull();
  });

  it("the app login falls back to Orange when the colours are missing or broken", () => {
    const base = { palette: "color", mode: "system", animation: "on" };
    expect(parsePublicDesignConfig(base)?.colors).toEqual(DEFAULT_DESIGN_CONFIG.colors);
    expect(parsePublicDesignConfig({ ...base, colors: { name: "Böse", accent_dark: "#000000", accent_light: "#ffffff" } })?.colors).toEqual(DEFAULT_COLOR_SET);
    expect(parsePublicDesignConfig({ ...base, colors: { name: "Grün", accent_dark: "#34c77b", accent_light: "#14804a" } })?.colors.name).toBe("Grün");
  });
});

describe("seeds in schema.sql match", () => {
  it("built-in colour sets", () => {
    const schema = readFileSync(join(__dirname, "../../../supabase/schema.sql"), "utf8");
    for (const s of BUILTIN_COLOR_SETS) {
      expect(schema).toContain(`('${s.id}', '${s.name}', 'builtin', '${s.accentDark}', '${s.accentLight}')`);
    }
  });
});
