// The public design configuration of the app login screen (get_public_design_config) and how a
// client falls back when it is missing or broken: last good copy, else the built-in defaults.

import { APP_LOGO_SPEC, validateLogoSpec, type LogoSpec } from "./logoSpec";
import type { BrandPaletteName } from "./palettes";
import { STANDARD_PARAMS, validatePresetParams, type PresetParams } from "./presets";

export type LoginMode = "system" | "light" | "dark";

export type PublicDesignConfig = {
  palette: BrandPaletteName;
  mode: LoginMode;
  animation: boolean;
  logo: LogoSpec;
  preset: PresetParams;
};

export const DEFAULT_DESIGN_CONFIG: PublicDesignConfig = {
  palette: "bw",
  mode: "system",
  animation: true,
  logo: APP_LOGO_SPEC,
  preset: STANDARD_PARAMS,
};

/** Larger answers are not even looked at. */
export const MAX_CONFIG_CHARS = 300_000;

/**
 * Checks an answer of get_public_design_config (or a cached copy). Unknown palette, mode or
 * switch: null (the whole answer is not trusted). A broken logo or preset alone falls back to the
 * built-in app logo / the standard preset.
 */
export function parsePublicDesignConfig(value: unknown): PublicDesignConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    if (JSON.stringify(value).length > MAX_CONFIG_CHARS) return null;
  } catch {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const palette = raw.palette;
  const mode = raw.mode;
  const animation = raw.animation;
  if (palette !== "color" && palette !== "bw") return null;
  if (mode !== "system" && mode !== "light" && mode !== "dark") return null;
  if (animation !== "on" && animation !== "off") return null;
  const logo = validateLogoSpec(raw.logo);
  const preset = validatePresetParams(raw.preset);
  return {
    palette,
    mode,
    animation: animation === "on",
    logo: logo.ok ? logo.spec : APP_LOGO_SPEC,
    preset: preset.ok ? preset.params : STANDARD_PARAMS,
  };
}

/** The same structure back (for the local copy). */
export function serializeDesignConfig(config: PublicDesignConfig): string {
  return JSON.stringify({
    palette: config.palette,
    mode: config.mode,
    animation: config.animation ? "on" : "off",
    logo: config.logo,
    preset: config.preset,
  });
}

/** Fresh answer, else the last good copy, else the defaults. */
export function resolveDesignConfig(remote: PublicDesignConfig | null, cached: PublicDesignConfig | null): PublicDesignConfig {
  return remote ?? cached ?? DEFAULT_DESIGN_CONFIG;
}
