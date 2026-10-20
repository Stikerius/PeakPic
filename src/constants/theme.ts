import { DarkTheme, type Theme } from "expo-router";

export const colors = {
  background: "#0B0B0F",
  surface: "#16161D",
  surfaceElevated: "#1F1F29",
  border: "#2A2A36",
  text: "#F5F5F7",
  textMuted: "#9A9AA8",
  primary: "#FF5A36",
  primaryMuted: "#7A2E1E",
  success: "#34C759",
  warning: "#FFB020",
  danger: "#FF453A",
} as const;

/** Ring around people with unseen stories, from bottom-left to top-right. */
export const storyRingGradient = ["#FFB020", colors.primary, "#E8336F"] as const;

/** Flame colour per streak tier (see FLAME_TIER_THRESHOLDS in lib/streak.ts). */
export const flameColors = ["#FFB347", "#FF7A1A", "#FF3B30", "#4DA3FF"] as const;

/** Flame size multiplier per streak tier. */
export const flameScale = [1, 1.15, 1.3, 1.5] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 9999,
} as const;

export const fontSize = {
  sm: 13,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

export type ColorName = keyof typeof colors;
export type SpacingName = keyof typeof spacing;

export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};
