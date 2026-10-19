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
