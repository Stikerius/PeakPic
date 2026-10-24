// Pure: the colour tokens of the dashboard, the only place colours are written down (besides the
// brand palettes in shared/brand). Applied as CSS custom properties through the CSSOM (allowed by
// the strict CSP), so styles.css only ever uses var(--…). Contrast of every combination is checked
// in src/lib/__tests__/appearance.test.ts (WCAG AA).

import type { StyleId } from "./appearance";
import { brandColors, type BrandMode, type BrandPaletteName } from "./brand";

export type TokenName =
  | "bg"
  | "surface"
  | "raised"
  | "chrome"
  | "border"
  | "divider"
  | "row-hover"
  | "text"
  | "text-2"
  | "text-3"
  | "accent"
  | "on-accent"
  | "accent-soft"
  | "focus"
  | "danger"
  | "success"
  | "warn-bg"
  | "warn-text"
  | "diff-added"
  | "diff-removed"
  | "backdrop"
  | "skeleton"
  | "qr-bg"
  | "muted-dot";

export type Tokens = Record<TokenName, string>;

type Neutral = Omit<Tokens, "accent" | "on-accent" | "accent-soft" | "focus">;

/** "Neu": deep black / warm light grey, 1px lines, no shadows. */
const NEW: Record<BrandMode, Neutral> = {
  dark: {
    bg: "#09090b",
    surface: "#111114",
    raised: "#1b1b1f",
    chrome: "rgba(9, 9, 11, 0.86)",
    border: "#27272a",
    divider: "#1e1e22",
    "row-hover": "#16161a",
    text: "#fafafa",
    "text-2": "#a8a8b0",
    "text-3": "#8e8e98",
    danger: "#ff7a70",
    success: "#4ade80",
    "warn-bg": "#2e230d",
    "warn-text": "#fcd479",
    "diff-added": "#11301b",
    "diff-removed": "#3a1616",
    backdrop: "rgba(0, 0, 0, 0.6)",
    skeleton: "#1f1f24",
    "qr-bg": "#ffffff",
    "muted-dot": "#3a3a40",
  },
  light: {
    bg: "#f7f7f5",
    surface: "#fdfdfb",
    raised: "#efefeb",
    chrome: "rgba(247, 247, 245, 0.88)",
    border: "#e4e4e0",
    divider: "#ebebe7",
    "row-hover": "#f1f1ed",
    text: "#18181b",
    "text-2": "#52525b",
    "text-3": "#65656e",
    danger: "#b4131a",
    success: "#1d6f33",
    "warn-bg": "#fdf0d2",
    "warn-text": "#6b4100",
    "diff-added": "#dcf5e3",
    "diff-removed": "#fbe1e1",
    backdrop: "rgba(0, 0, 0, 0.35)",
    skeleton: "#e9e9e4",
    "qr-bg": "#ffffff",
    "muted-dot": "#cfcfc8",
  },
};

/** "Klassisch": the first look of the dashboard (contrast raised where it was below AA). */
const CLASSIC: Record<BrandMode, Neutral> = {
  dark: {
    bg: "#111113",
    surface: "#1a1a1d",
    raised: "#252529",
    chrome: "#1a1a1d",
    border: "#323237",
    divider: "#2a2a2e",
    "row-hover": "#202024",
    text: "#f2f2f3",
    "text-2": "#a1a1a8",
    "text-3": "#8e8e96",
    danger: "#ff6b61",
    success: "#30d158",
    "warn-bg": "#3a2d10",
    "warn-text": "#ffd27a",
    "diff-added": "#12331c",
    "diff-removed": "#3a1616",
    backdrop: "rgba(0, 0, 0, 0.55)",
    skeleton: "#2a2a2e",
    "qr-bg": "#ffffff",
    "muted-dot": "#3a3a40",
  },
  light: {
    bg: "#f2f2f4",
    surface: "#fbfbfc",
    raised: "#e9e9ec",
    chrome: "#fbfbfc",
    border: "#d9d9de",
    divider: "#e3e3e7",
    "row-hover": "#f0f0f3",
    text: "#17171a",
    "text-2": "#55555d",
    "text-3": "#64646c",
    danger: "#b4131a",
    success: "#1f7a36",
    "warn-bg": "#fff1d6",
    "warn-text": "#6b4100",
    "diff-added": "#dcf5e3",
    "diff-removed": "#fbe1e1",
    backdrop: "rgba(0, 0, 0, 0.45)",
    skeleton: "#e4e4e8",
    "qr-bg": "#ffffff",
    "muted-dot": "#cfcfc8",
  },
};

const NEUTRALS: Record<StyleId, Record<BrandMode, Neutral>> = { new: NEW, classic: CLASSIC };

/** Quiet accent backgrounds (selected states, highlighted rows). */
const ACCENT_SOFT: Record<BrandPaletteName, Record<BrandMode, string>> = {
  color: { dark: "#3a1a12", light: "#fde3da" },
  bw: { dark: "#26262b", light: "#e4e4e0" },
};

export function tokensFor(style: StyleId, mode: BrandMode, palette: BrandPaletteName): Tokens {
  const brand = brandColors(palette, mode);
  return {
    ...NEUTRALS[style][mode],
    accent: brand.accent,
    "on-accent": brand.onAccent,
    "accent-soft": ACCENT_SOFT[palette][mode],
    // The focus ring is the accent; in black and white it is the text colour (always visible).
    focus: palette === "bw" ? NEUTRALS[style][mode].text : brand.accent,
  };
}

/** Writes the tokens as custom properties on an element (the root, or a preview box). */
export function applyTokens(element: HTMLElement, tokens: Tokens): void {
  for (const [name, value] of Object.entries(tokens)) element.style.setProperty(`--${name}`, value);
}

// ------------------------------------------------------------------ contrast (WCAG 2.x)

function channel(hex: string, start: number): number {
  const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of #rrggbb. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
