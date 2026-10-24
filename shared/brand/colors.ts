// Colour sets ("Hauptfarben"): the accent of the palette "Hauptfarbe" for dark and light, plus
// chart colours. Pure functions (no imports), so the app, the dashboard and the tests share them;
// public.brand_color_set_problem() in schema.sql enforces the same rules (compared by a test).
//
// Rules:
//  * accent against every reference background of its mode: at least 3:1
//  * text on accent surfaces: #1b0f0a or #ffffff, whichever contrasts more; it must reach 4.5:1
//  * accent as text (links): an adjusted variant with at least 4.5:1 ("accent-text")
//  * chart colours: at most 8, each at least 3:1 against the backgrounds of both modes; without
//    own colours they are derived from the accent (distinct hues); charts also use patterns and
//    labels, so they never rely on colour alone

export type ColorSetValues = {
  accentDark: string;
  accentLight: string;
  /** Own chart colours (null: derived from the accent). */
  chartColors: readonly string[] | null;
};

export type ColorSet = ColorSetValues & { name: string };

export const ON_ACCENT_DARK = "#1b0f0a";
export const ON_ACCENT_LIGHT = "#ffffff";
export const MAX_CHART_COLORS = 8;

/**
 * Backgrounds an accent must stand out against (page and surfaces of both dashboard styles and the
 * app). Same list in schema.sql.
 */
export const REFERENCE_BACKGROUNDS = {
  dark: ["#09090b", "#111114", "#111113", "#1a1a1d"],
  light: ["#f7f7f5", "#fdfdfb", "#f2f2f4", "#fbfbfc"],
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function channel(hex: string, start: number): number {
  const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of #rrggbb. */
export function relativeLuminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The lowest contrast of `color` against a list of backgrounds. */
export function minContrast(color: string, backgrounds: readonly string[]): number {
  return Math.min(...backgrounds.map((bg) => contrastRatio(color, bg)));
}

/** Text colour on an accent surface: the one of #1b0f0a and #ffffff with more contrast (tie: the dark one). */
export function onAccentColor(accent: string): string {
  return contrastRatio(ON_ACCENT_LIGHT, accent) > contrastRatio(ON_ACCENT_DARK, accent) ? ON_ACCENT_LIGHT : ON_ACCENT_DARK;
}

/** `top` laid over `bottom` with the given opacity, as an opaque colour (both #rrggbb). */
export function blendHex(bottom: string, top: string, alpha: number): string {
  "worklet";
  const mix = (i: number) => {
    const a = Number.parseInt(bottom.slice(i, i + 2), 16);
    const b = Number.parseInt(top.slice(i, i + 2), 16);
    return Math.round(a * (1 - alpha) + b * alpha)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

// ------------------------------------------------------------------ HSL (for corrections and hues)

function toHsl(hex: string): [number, number, number] {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * The colour itself if it reaches `min` against all `backgrounds`, otherwise the nearest variant
 * (same hue and saturation, lighter on dark backgrounds, darker on light ones) that does.
 */
export function ensureAccessible(color: string, backgrounds: readonly string[], min: number): string {
  const hex = normalizeHex(color);
  if (minContrast(hex, backgrounds) >= min) return hex;
  const [h, s, l] = toHsl(hex);
  const darkBackgrounds = backgrounds.every((bg) => relativeLuminance(bg) < 0.2);
  for (let step = 1; step <= 100; step += 1) {
    const next = darkBackgrounds ? Math.min(1, l + step / 100) : Math.max(0, l - step / 100);
    const candidate = fromHsl(h, s, next);
    if (minContrast(candidate, backgrounds) >= min) return candidate;
  }
  return darkBackgrounds ? "#ffffff" : "#000000";
}

/** The accent as text colour (links): at least 4.5:1 against the backgrounds of the mode. */
export function accentTextColor(accent: string, mode: "dark" | "light"): string {
  return ensureAccessible(accent, REFERENCE_BACKGROUNDS[mode], 4.5);
}

/** All reference backgrounds of both modes (chart colours have to work on both). */
const ALL_BACKGROUNDS: readonly string[] = [...REFERENCE_BACKGROUNDS.dark, ...REFERENCE_BACKGROUNDS.light];

/** Hue steps from the accent, spread so neighbours in a chart are easy to tell apart. */
const HUE_STEPS = [0, 150, 60, 210, 300, 30, 255, 105] as const;

/**
 * Chart colours derived from the accent: distinct hues, each at least 3:1 against the
 * backgrounds of both modes (a mid lightness that works on black and on white).
 */
export function deriveChartColors(accent: string): string[] {
  const [h] = toHsl(normalizeHex(accent));
  return HUE_STEPS.map((step) => {
    const hue = (h + step) % 360;
    let best = fromHsl(hue, 0.7, 0.5);
    let bestContrast = minContrast(best, ALL_BACKGROUNDS);
    for (let l = 0.3; l <= 0.75; l += 0.01) {
      const candidate = fromHsl(hue, 0.7, l);
      const c = minContrast(candidate, ALL_BACKGROUNDS);
      if (c > bestContrast) {
        best = candidate;
        bestContrast = c;
      }
    }
    return best;
  });
}

/** The chart colours a set uses: its own, or the derived ones. */
export function chartColorsOf(set: ColorSetValues): string[] {
  return set.chartColors !== null && set.chartColors.length > 0 ? set.chartColors.map(normalizeHex) : deriveChartColors(set.accentDark);
}

export type ColorProblem = {
  code:
    | "invalid_name"
    | "invalid_hex"
    | "accent_dark_contrast"
    | "accent_light_contrast"
    | "on_accent_dark"
    | "on_accent_light"
    | "invalid_chart"
    | "chart_contrast";
  message: string;
  /** A corrected value that would pass (where one exists). */
  suggestion?: Partial<ColorSetValues>;
};

/** Why a colour set can't be saved, or null. Same rules as public.brand_color_set_problem(). */
export function colorSetProblem(values: ColorSetValues): ColorProblem | null {
  if (!isHex(values.accentDark) || !isHex(values.accentLight)) {
    return { code: "invalid_hex", message: "Farben bitte als #RRGGBB angeben." };
  }
  const dark = normalizeHex(values.accentDark);
  const light = normalizeHex(values.accentLight);
  if (minContrast(dark, REFERENCE_BACKGROUNDS.dark) < 3) {
    return {
      code: "accent_dark_contrast",
      message: "Die Farbe für Dunkel hebt sich zu wenig vom dunklen Hintergrund ab (mindestens 3 zu 1).",
      suggestion: { accentDark: ensureAccessible(dark, REFERENCE_BACKGROUNDS.dark, 3) },
    };
  }
  if (minContrast(light, REFERENCE_BACKGROUNDS.light) < 3) {
    return {
      code: "accent_light_contrast",
      message: "Die Farbe für Hell hebt sich zu wenig vom hellen Hintergrund ab (mindestens 3 zu 1).",
      suggestion: { accentLight: ensureAccessible(light, REFERENCE_BACKGROUNDS.light, 3) },
    };
  }
  if (contrastRatio(onAccentColor(dark), dark) < 4.5) {
    return {
      code: "on_accent_dark",
      message: "Auf der Farbe für Dunkel ist weder dunkle noch weisse Schrift gut lesbar (mindestens 4,5 zu 1).",
      suggestion: { accentDark: ensureAccessible(dark, [ON_ACCENT_DARK], 4.5) },
    };
  }
  if (contrastRatio(onAccentColor(light), light) < 4.5) {
    return {
      code: "on_accent_light",
      message: "Auf der Farbe für Hell ist weder dunkle noch weisse Schrift gut lesbar (mindestens 4,5 zu 1).",
      suggestion: { accentLight: ensureAccessible(light, [ON_ACCENT_LIGHT], 4.5) },
    };
  }
  if (values.chartColors !== null) {
    if (values.chartColors.length > MAX_CHART_COLORS || !values.chartColors.every(isHex)) {
      return { code: "invalid_chart", message: `Höchstens ${MAX_CHART_COLORS} Diagrammfarben als #RRGGBB.` };
    }
    const bad = values.chartColors.findIndex((c) => minContrast(normalizeHex(c), ALL_BACKGROUNDS) < 3);
    if (bad !== -1) {
      return {
        code: "chart_contrast",
        message: `Diagrammfarbe ${bad + 1} hebt sich nicht auf hellem und dunklem Hintergrund ab (mindestens 3 zu 1).`,
        suggestion: { chartColors: null },
      };
    }
  }
  return null;
}

// ------------------------------------------------------------------ built-in sets

export const ORANGE_COLOR_SET_ID = "00000000-0000-4000-8000-00000000c001";

/** Same ids and values as the seeds in schema.sql (checked by a test). "Orange" is the default. */
export const BUILTIN_COLOR_SETS: readonly (ColorSet & { id: string })[] = [
  { id: ORANGE_COLOR_SET_ID, name: "Orange", accentDark: "#ff5a36", accentLight: "#f2481f", chartColors: null },
  { id: "00000000-0000-4000-8000-00000000c002", name: "Blau", accentDark: "#4d9fff", accentLight: "#1f6fd6", chartColors: null },
  { id: "00000000-0000-4000-8000-00000000c003", name: "Grün", accentDark: "#34c77b", accentLight: "#14804a", chartColors: null },
  { id: "00000000-0000-4000-8000-00000000c004", name: "Violett", accentDark: "#a78bfa", accentLight: "#7c3aed", chartColors: null },
  { id: "00000000-0000-4000-8000-00000000c005", name: "Rot", accentDark: "#ff6b6b", accentLight: "#d62839", chartColors: null },
];

export const DEFAULT_COLOR_SET: ColorSet = BUILTIN_COLOR_SETS[0] ?? {
  name: "Orange",
  accentDark: "#ff5a36",
  accentLight: "#f2481f",
  chartColors: null,
};

/**
 * A colour set from a public answer ({name, accent_dark, accent_light, chart_colors}) or a
 * cached copy; checked with the same rules. Anything wrong: null (the caller uses "Orange").
 */
export function parseColorSet(value: unknown): ColorSet | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 40) return null;
  const chart = raw.chart_colors;
  if (chart !== null && chart !== undefined && !Array.isArray(chart)) return null;
  const set: ColorSet = {
    name,
    accentDark: typeof raw.accent_dark === "string" ? raw.accent_dark : "",
    accentLight: typeof raw.accent_light === "string" ? raw.accent_light : "",
    chartColors: Array.isArray(chart) ? chart.map((c) => (typeof c === "string" ? c : "")) : null,
  };
  if (colorSetProblem(set) !== null) return null;
  return {
    name: set.name,
    accentDark: normalizeHex(set.accentDark),
    accentLight: normalizeHex(set.accentLight),
    chartColors: set.chartColors === null ? null : set.chartColors.map(normalizeHex),
  };
}

/** The public shape of a set (for caching it like the server sends it). */
export function colorSetToPublic(set: ColorSet): Record<string, unknown> {
  return { name: set.name, accent_dark: set.accentDark, accent_light: set.accentLight, chart_colors: set.chartColors };
}
