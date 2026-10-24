import type { ColorScheme, Palette } from "@/constants/theme";

import { blendHex, normalizeHex, onAccentColor, type ColorSetValues } from "../../shared/brand/colors";

/**
 * The palette with the accent of a colour set from the dashboard (only the login screen uses
 * this): the accent of the scheme, text on it in the dark or white text colour (whichever reaches 4.5:1), and
 * the quiet accent background mixed from the screen background. Everything else stays.
 */
export function withColorSet(base: Palette, scheme: ColorScheme, set: ColorSetValues): Palette {
  const accent = normalizeHex(scheme === "dark" ? set.accentDark : set.accentLight);
  return {
    ...base,
    accent,
    onAccent: onAccentColor(accent),
    accentSoft: blendHex(normalizeHex(base.background), accent, scheme === "dark" ? 0.2 : 0.16),
  };
}
