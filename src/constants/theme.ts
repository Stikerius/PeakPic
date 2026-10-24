import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from "expo-router";
import type { TextStyle } from "react-native";

import { brandColors, type BrandColors, type BrandPaletteName } from "../../shared/brand/palettes";

/**
 * Design tokens. Components never use raw colour values: they read the
 * active palette through `useTheme()` (see lib/theme.tsx). The only
 * scheme-independent colours are `onPhoto` (UI that sits on top of photos and
 * the camera, which is always dark) and the content colours below.
 */

export type ColorScheme = "light" | "dark";

/** What the user picked in Einstellungen → Darstellung. */
export type ThemePreference = "system" | ColorScheme;

/** The flame orange is the only accent colour of the app. */
export const accent = "#FF5A36";

export type Palette = {
  /** Screen background. */
  background: string;
  /** Lists, cards, headers and the tab bar, slightly set off from the background. */
  surface: string;
  /** Controls on a surface: inputs, segmented tracks, pressed rows. */
  surfaceRaised: string;
  /** The selected segment on a `surfaceRaised` track. */
  controlActive: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** 1px outlines around inputs and cards. */
  border: string;
  /** Hairlines between list rows. */
  divider: string;
  accent: string;
  /** Quiet accent background (selected states, badges on surfaces). */
  accentSoft: string;
  /** Text and icons on top of `accent`. */
  onAccent: string;
  success: string;
  danger: string;
  warning: string;
  /** Dims the screen behind sheets and dialogs. */
  backdrop: string;
};

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    background: "#F2F2F4",
    surface: "#FBFBFC",
    surfaceRaised: "#E9E9EC",
    controlActive: "#FDFDFD",
    text: "#17171A",
    textSecondary: "#5C5C64",
    textTertiary: "#8C8C94",
    border: "#D9D9DE",
    divider: "#E3E3E7",
    accent,
    accentSoft: "#FFE4DC",
    onAccent: "#FFFFFF",
    success: "#248A3D",
    danger: "#D70015",
    warning: "#B25000",
    backdrop: "rgba(0, 0, 0, 0.35)",
  },
  dark: {
    background: "#111113",
    surface: "#1A1A1D",
    surfaceRaised: "#252529",
    controlActive: "#3A3A40",
    text: "#F2F2F3",
    textSecondary: "#A1A1A8",
    textTertiary: "#6E6E76",
    border: "#323237",
    divider: "#28282C",
    accent,
    accentSoft: "#3D1E16",
    onAccent: "#FFFFFF",
    success: "#30D158",
    danger: "#FF453A",
    warning: "#FFB020",
    backdrop: "rgba(0, 0, 0, 0.55)",
  },
};

/**
 * UI on top of photos (camera, story viewer, editors, full-screen viewers).
 * Deliberately the same in light and dark mode so it stays legible on images.
 */
export const onPhoto = {
  background: "#000000",
  text: "#FFFFFF",
  textSecondary: "rgba(255, 255, 255, 0.75)",
  textTertiary: "rgba(255, 255, 255, 0.6)",
  /** Controls and chips floating on a photo. */
  scrim: "rgba(0, 0, 0, 0.45)",
  scrimLight: "rgba(0, 0, 0, 0.35)",
  scrimStrong: "rgba(0, 0, 0, 0.6)",
  /** Light fills on dark photo UI (progress tracks, inactive dots, buttons). */
  fill: "rgba(255, 255, 255, 0.15)",
  fillStrong: "rgba(255, 255, 255, 0.35)",
  fillProgress: "rgba(255, 255, 255, 0.85)",
  outline: "rgba(255, 255, 255, 0.6)",
  textShadow: "rgba(0, 0, 0, 0.6)",
  /** Suggestion list floating over the media editor. */
  panel: "rgba(20, 20, 26, 0.95)",
} as const;

/** Colours the user can give text on a photo. Content, not UI chrome. */
export const photoTextColors = [
  "#FFFFFF",
  "#000000",
  accent,
  "#FFD60A",
  "#34C759",
  "#0A84FF",
  "#FF375F",
] as const;

/** Ring around people with unseen stories, from bottom-left to top-right. */
export const storyRingGradient = ["#FFB020", accent, "#E8336F"] as const;

/**
 * Logo animation (login screen): background, lines, muted dots and the accent per palette
 * ("Hauptfarbe" / "Schwarz-Weiss") and scheme. The values live in shared/brand/palettes.ts, which
 * the admin dashboard uses as well.
 */
export { brandColors };
export type { BrandColors, BrandPaletteName };

/**
 * Technical colours of the logo animation, not design colours: an SVG mask shows where it is
 * white and hides where it is black; the shine is white at 55 % opacity in every palette.
 */
export const brandMask = { show: "#FFFFFF", hide: "#000000" } as const;
export const brandShine = "#FFFFFF";

/** Flame colour per streak tier (see FLAME_TIER_THRESHOLDS in lib/streak.ts). */
export const flameColors = ["#FFB347", "#FF7A1A", "#FF3B30", "#4DA3FF"] as const;

/** Flame size multiplier per streak tier. */
export const flameScale = [1, 1.15, 1.3, 1.5] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  /** 12 */
  ms: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  /** Avatars and pills only. */
  full: 9999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

/** Type scale (San Francisco). Spread into a text style: `{ ...typography.body }`. */
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: "600" },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  /** For counters like the streak, so digits don't jump. */
  numeric: { fontVariant: ["tabular-nums"] },
} as const satisfies Record<string, TextStyle>;

export type ColorName = keyof Palette;
export type SpacingName = keyof typeof spacing;

export function navigationThemeFor(scheme: ColorScheme): NavigationTheme {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const colors = palettes[scheme];
  return {
    ...base,
    dark: scheme === "dark",
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
  };
}
