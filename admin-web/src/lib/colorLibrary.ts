// Pure logic of the "Hauptfarben" section (unit tested in src/lib/__tests__/colorLibrary.test.ts).

import {
  MAX_CHART_COLORS,
  REFERENCE_BACKGROUNDS,
  accentTextColor,
  colorSetProblem,
  contrastRatio,
  deriveChartColors,
  isHex,
  minContrast,
  normalizeHex,
  onAccentColor,
  type BrandMode,
  type ColorProblem,
} from "./brand";

export type ColorTarget = "dashboard_colors" | "app_login_colors";
export const COLOR_TARGETS: readonly ColorTarget[] = ["dashboard_colors", "app_login_colors"];
export const MAX_CUSTOM_COLOR_SETS = 20;

/** What the editor holds; hex fields may be half typed. chartColors null = derived automatically. */
export type ColorDraft = { name: string; accentDark: string; accentLight: string; chartColors: string[] | null };

/** Why the draft can't be saved, or null: name first, then the same rules as on the server. */
export function draftProblem(draft: ColorDraft): ColorProblem | null {
  const name = draft.name.trim();
  if (name.length === 0 || name.length > 40) return { code: "invalid_name", message: "Name fehlt oder ist länger als 40 Zeichen." };
  return colorSetProblem(draft);
}

/** The draft with the problem's suggestion applied (the editor's "Vorschlag übernehmen"). */
export function applySuggestion(draft: ColorDraft, problem: ColorProblem | null): ColorDraft {
  if (problem?.suggestion === undefined) return draft;
  const { accentDark, accentLight, chartColors } = problem.suggestion;
  return {
    ...draft,
    ...(accentDark !== undefined ? { accentDark } : {}),
    ...(accentLight !== undefined ? { accentLight } : {}),
    ...(chartColors !== undefined ? { chartColors: chartColors === null ? null : [...chartColors] } : {}),
  };
}

/** A value for the native colour field, which only takes #rrggbb (half typed values keep the last valid one). */
export function colorFieldValue(value: string, fallback: string): string {
  return isHex(value) ? normalizeHex(value) : fallback;
}

/** The chart colours to start editing with: the saved ones, else the ones derived from the dark accent. */
export function editableChartColors(draft: ColorDraft): string[] {
  if (draft.chartColors !== null) return draft.chartColors.slice(0, MAX_CHART_COLORS);
  return deriveChartColors(isHex(draft.accentDark) ? normalizeHex(draft.accentDark) : "#ff5a36");
}

/**
 * Targets ticked by default when activating: the targets that don't show this set yet. Targets
 * that already show it are not offered again.
 */
export function defaultColorTargets(sets: readonly { id: string; targets: readonly ColorTarget[] }[], id: string): ColorTarget[] {
  const activeOn = (target: ColorTarget) => sets.find((s) => s.targets.includes(target))?.id ?? null;
  return COLOR_TARGETS.filter((t) => activeOn(t) !== id);
}

/** Whether a colour set may be deleted, and why not. */
export function colorDeleteBlocker(set: { kind: "builtin" | "custom"; targets: readonly ColorTarget[] }): string | null {
  if (set.kind === "builtin") return "Eingebaute Farbsätze lassen sich nicht löschen.";
  if (set.targets.length > 0) return "Aktive Farbsätze lassen sich nicht löschen.";
  return null;
}

export type ContrastSummary = { accent: number; onAccent: number; link: number };

/**
 * The contrasts the editor shows for one mode (lowest over the reference backgrounds): accent on
 * the background (rule: 3:1), text on the accent (4.5:1) and links in the accent text colour
 * (4.5:1). Null while the value is not a complete hex colour.
 */
export function contrastSummary(accent: string, mode: BrandMode): ContrastSummary | null {
  if (!isHex(accent)) return null;
  const hex = normalizeHex(accent);
  const backgrounds = REFERENCE_BACKGROUNDS[mode];
  return {
    accent: minContrast(hex, backgrounds),
    onAccent: contrastRatio(onAccentColor(hex), hex),
    link: minContrast(accentTextColor(hex, mode), backgrounds),
  };
}

/** "4,6 : 1" */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",")} : 1`;
}
