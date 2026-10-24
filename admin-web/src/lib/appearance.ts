// Pure: the dashboard's look as chosen in this browser (unit tested in
// src/lib/__tests__/appearance.test.ts). Stored locally only, never on the server and without any
// reference to a person. The logo is not part of it: it comes from the library.

import type { BrandMode, BrandPaletteName } from "./brand";

/** Registered styles. A third one: add it here, give it tokens (tokens.ts) and layout rules (styles.css). */
export const STYLES = [
  { id: "new", label: "Neu" },
  { id: "classic", label: "Klassisch" },
] as const;
export type StyleId = (typeof STYLES)[number]["id"];

export type ModePreference = "system" | BrandMode;
/** Background animations: on, calm (still image only) or off. */
export type Ambient = "on" | "calm" | "off";

export type Appearance = {
  style: StyleId;
  mode: ModePreference;
  palette: BrandPaletteName;
  ambient: Ambient;
};

export const DEFAULT_APPEARANCE: Appearance = { style: "new", mode: "system", palette: "bw", ambient: "on" };

export const STORAGE_KEY = "peakpic-admin-appearance";
/** The first version stored only light/dark under this key. */
export const LEGACY_THEME_KEY = "peakpic-admin-theme";

export const MODE_LABELS: Record<ModePreference, string> = { system: "System", light: "Hell", dark: "Dunkel" };
export const AMBIENT_LABELS: Record<Ambient, string> = { on: "An", calm: "Ruhig (nur Standbild)", off: "Aus" };

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * The stored choice; every missing or unknown value falls back to its default (a broken entry
 * never breaks the dashboard). An old light/dark choice is taken over as the mode.
 */
export function parseAppearance(stored: string | null, legacyTheme: string | null = null): Appearance {
  let raw: Record<string, unknown> = {};
  if (stored !== null) {
    try {
      const value: unknown = JSON.parse(stored);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) raw = value as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const legacyMode = legacyTheme === "light" || legacyTheme === "dark" ? legacyTheme : DEFAULT_APPEARANCE.mode;
  return {
    style: pick(raw.style, STYLES.map((s) => s.id), DEFAULT_APPEARANCE.style),
    mode: pick(raw.mode, ["system", "light", "dark"], stored === null ? legacyMode : DEFAULT_APPEARANCE.mode),
    palette: pick(raw.palette, ["color", "bw"], DEFAULT_APPEARANCE.palette),
    ambient: pick(raw.ambient, ["on", "calm", "off"], DEFAULT_APPEARANCE.ambient),
  };
}

export function serializeAppearance(appearance: Appearance): string {
  return JSON.stringify(appearance);
}

/** The mode actually shown: the choice, or the system's with "System". */
export function resolveMode(preference: ModePreference, systemDark: boolean): BrandMode {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}
