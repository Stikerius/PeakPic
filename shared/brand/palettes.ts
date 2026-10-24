// Brand colours of the logo animation (app login and dashboard). The app re-exports them as tokens
// in src/constants/theme.ts; nowhere else are these values written down. The accent of the palette
// "Hauptfarbe" comes from the active colour set (colors.ts, default "Orange").

import { DEFAULT_COLOR_SET, onAccentColor, type ColorSetValues } from "./colors";

export type BrandPaletteName = "color" | "bw";
export type BrandMode = "light" | "dark";

export type BrandColors = {
  background: string;
  line: string;
  /** Muted dots of the raster. */
  mutedDot: string;
  /** Logo, outline, lit dots. */
  accent: string;
  /** Text on accent surfaces. */
  onAccent: string;
};

const BASE: Record<BrandMode, Pick<BrandColors, "background" | "line" | "mutedDot">> = {
  dark: { background: "#09090b", line: "#27272a", mutedDot: "#3a3a40" },
  light: { background: "#f7f7f5", line: "#e4e4e0", mutedDot: "#cfcfc8" },
};

/** "Schwarz-Weiss": white on dark, near black on light. Independent of the colour sets. */
const BLACK_AND_WHITE: Record<BrandMode, Pick<BrandColors, "accent" | "onAccent">> = {
  dark: { accent: "#fafafa", onAccent: "#1b0f0a" },
  light: { accent: "#18181b", onAccent: "#ffffff" },
};

export function brandColors(palette: BrandPaletteName, mode: BrandMode, colorSet: ColorSetValues = DEFAULT_COLOR_SET): BrandColors {
  if (palette === "bw") return { ...BASE[mode], ...BLACK_AND_WHITE[mode] };
  const accent = mode === "dark" ? colorSet.accentDark : colorSet.accentLight;
  return { ...BASE[mode], accent, onAccent: onAccentColor(accent) };
}

/**
 * Technical colours, not design colours: an SVG mask shows where it is white and hides where it is
 * black; the shine is white (at 55 % opacity) in every palette.
 */
export const BRAND_MASK = { show: "#ffffff", hide: "#000000" } as const;
export const BRAND_SHINE = "#ffffff";

export const BRAND_PALETTE_LABELS: Record<BrandPaletteName, string> = { color: "Hauptfarbe", bw: "Schwarz-Weiss" };
