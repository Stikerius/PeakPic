// Brand colours of the logo animation (app login and dashboard). The app re-exports them as tokens
// in src/constants/theme.ts; nowhere else are these values written down.

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

const ACCENT: Record<BrandPaletteName, Record<BrandMode, Pick<BrandColors, "accent" | "onAccent">>> = {
  // "Hauptfarbe": flame orange.
  color: {
    dark: { accent: "#ff5a36", onAccent: "#1b0f0a" },
    light: { accent: "#f2481f", onAccent: "#1b0f0a" },
  },
  // "Schwarz-Weiss": white on dark, near black on light.
  bw: {
    dark: { accent: "#fafafa", onAccent: "#1b0f0a" },
    light: { accent: "#18181b", onAccent: "#ffffff" },
  },
};

export function brandColors(palette: BrandPaletteName, mode: BrandMode): BrandColors {
  return { ...BASE[mode], ...ACCENT[palette][mode] };
}

/**
 * Technical colours, not design colours: an SVG mask shows where it is white and hides where it is
 * black; the shine is white (at 55 % opacity) in every palette.
 */
export const BRAND_MASK = { show: "#ffffff", hide: "#000000" } as const;
export const BRAND_SHINE = "#ffffff";

export const BRAND_PALETTE_LABELS: Record<BrandPaletteName, string> = { color: "Hauptfarbe", bw: "Schwarz-Weiss" };
