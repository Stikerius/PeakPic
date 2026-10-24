import { describe, expect, it } from "@jest/globals";

import { palettes } from "@/constants/theme";
import { withColorSet } from "@/lib/accentPalette";

import { BUILTIN_COLOR_SETS, contrastRatio } from "../../../shared/brand/colors";

describe("login screen with a colour set", () => {
  it("takes the accent of the scheme and a readable text colour on it", () => {
    for (const set of BUILTIN_COLOR_SETS) {
      for (const scheme of ["light", "dark"] as const) {
        const colors = withColorSet(palettes[scheme], scheme, set);
        expect(colors.accent).toBe(scheme === "dark" ? set.accentDark : set.accentLight);
        expect(contrastRatio(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.accent, colors.background.toLowerCase())).toBeGreaterThanOrEqual(3);
        expect(colors.accentSoft).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("changes nothing but the accent colours", () => {
    const blue = BUILTIN_COLOR_SETS[1] ?? BUILTIN_COLOR_SETS[0];
    if (blue === undefined) throw new Error("no colour sets");
    const { accent, onAccent, accentSoft, ...rest } = withColorSet(palettes.dark, "dark", blue);
    const { accent: a, onAccent: o, accentSoft: s, ...base } = palettes.dark;
    expect(rest).toEqual(base);
    expect([accent, onAccent, accentSoft]).not.toEqual([a, o, s]);
  });
});
