import { describe, expect, it } from "@jest/globals";

import {
  applySuggestion,
  colorDeleteBlocker,
  colorFieldValue,
  contrastSummary,
  defaultColorTargets,
  draftProblem,
  editableChartColors,
  formatRatio,
  type ColorDraft,
} from "../../../admin-web/src/lib/colorLibrary";
import { MAX_CHART_COLORS, deriveChartColors } from "../../../shared/brand/colors";

const draft = (change: Partial<ColorDraft> = {}): ColorDraft => ({ name: "Meeresblau", accentDark: "#4d9fff", accentLight: "#1f6fd6", chartColors: null, ...change });

describe("colour set editor", () => {
  it("name is checked before the colours", () => {
    expect(draftProblem(draft())).toBeNull();
    expect(draftProblem(draft({ name: "  " }))?.code).toBe("invalid_name");
    expect(draftProblem(draft({ name: "x".repeat(41) }))?.code).toBe("invalid_name");
    expect(draftProblem(draft({ accentDark: "#4d9ff" }))?.code).toBe("invalid_hex");
  });

  it("the suggestion makes an unreadable draft pass", () => {
    const tooDark = draft({ accentDark: "#202024" });
    const fixed = applySuggestion(tooDark, draftProblem(tooDark));
    expect(fixed.accentDark).not.toBe("#202024");
    expect(fixed.name).toBe("Meeresblau");
    expect(draftProblem(fixed)).toBeNull();
    const badChart = draft({ chartColors: ["#fafafa"] });
    expect(applySuggestion(badChart, draftProblem(badChart)).chartColors).toBeNull();
    expect(applySuggestion(draft(), null)).toEqual(draft());
  });

  it("native colour field only gets complete values", () => {
    expect(colorFieldValue("#4D9FFF", "#000000")).toBe("#4d9fff");
    expect(colorFieldValue("#4d9", "#123456")).toBe("#123456");
  });

  it("custom chart colours start from the saved or derived ones", () => {
    expect(editableChartColors(draft())).toEqual(deriveChartColors("#4d9fff"));
    expect(editableChartColors(draft({ chartColors: ["#1f6fd6"] }))).toEqual(["#1f6fd6"]);
    expect(editableChartColors(draft({ chartColors: Array.from({ length: 12 }, () => "#1f6fd6") }))).toHaveLength(MAX_CHART_COLORS);
  });
});

describe("activating and deleting", () => {
  const sets = [
    { id: "orange", kind: "builtin" as const, targets: ["dashboard_colors" as const] },
    { id: "blue", kind: "builtin" as const, targets: ["app_login_colors" as const] },
    { id: "mine", kind: "custom" as const, targets: [] },
  ];

  it("offers the targets that don't show the set yet", () => {
    expect(defaultColorTargets(sets, "mine")).toEqual(["dashboard_colors", "app_login_colors"]);
    expect(defaultColorTargets(sets, "orange")).toEqual(["app_login_colors"]);
  });

  it("built-in and active sets can't be deleted", () => {
    expect(colorDeleteBlocker(sets[0] ?? sets[2])).toMatch(/Eingebaute/);
    expect(colorDeleteBlocker({ kind: "custom", targets: ["dashboard_colors"] })).toMatch(/Aktive/);
    expect(colorDeleteBlocker({ kind: "custom", targets: [] })).toBeNull();
  });
});

describe("contrast summary", () => {
  it("shows the three rules per mode, rounded down", () => {
    const dark = contrastSummary("#ff5a36", "dark");
    expect(dark?.accent).toBeGreaterThanOrEqual(3);
    expect(dark?.onAccent).toBeGreaterThanOrEqual(4.5);
    expect(dark?.link).toBeGreaterThanOrEqual(4.5);
    expect(contrastSummary("#ff5a3", "dark")).toBeNull();
    expect(formatRatio(4.4999)).toBe("4,4 : 1");
    expect(formatRatio(21)).toBe("21,0 : 1");
  });
});
