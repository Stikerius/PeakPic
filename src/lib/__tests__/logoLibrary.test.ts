import { describe, expect, it } from "@jest/globals";

import { assembleLogo, defaultTargets, deleteBlocker, duplicateName, uploadProblem } from "../../../admin-web/src/lib/logoLibrary";
import { APP_LOGO_SPEC, type LogoSpec } from "../../../shared/brand/logoSpec";

describe("upload checks in the browser (the server checks again)", () => {
  it("only .svg up to 200 KB", () => {
    expect(uploadProblem({ name: "logo.svg", size: 1000 })).toBeNull();
    expect(uploadProblem({ name: "LOGO.SVG", size: 200 * 1024 })).toBeNull();
    expect(uploadProblem({ name: "logo.png", size: 1000 })).toMatch(/SVG/);
    expect(uploadProblem({ name: "logo.svg.exe", size: 1000 })).toMatch(/SVG/);
    expect(uploadProblem({ name: "logo.svg", size: 200 * 1024 + 1 })).toMatch(/200 KB/);
    expect(uploadProblem({ name: "logo.svg", size: 0 })).toMatch(/leer/);
  });
});

describe("assembling a logo from the chosen roles", () => {
  const withBackground: LogoSpec = {
    version: 1,
    viewBox: [40, 40, 300, 300],
    shapes: [{ type: "rect", x: 40, y: 40, width: 300, height: 300, rx: 0, ry: 0, role: "fill", transform: [1, 0, 0, 1, 0, 0] }, ...APP_LOGO_SPEC.shapes],
  };

  it("leaves out shapes, applies roles and fits the viewBox", () => {
    const choices = [
      { role: "fill" as const, omit: true },
      { role: "fill" as const, omit: false },
      { role: "fill" as const, omit: false },
      { role: "fill" as const, omit: false },
      { role: "cutout" as const, omit: false },
    ];
    const result = assembleLogo(withBackground, choices, true, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.shapes).toHaveLength(4);
    expect(result.spec.shapes.map((s) => s.role)).toEqual(["fill", "fill", "fill", "cutout"]);
    // The fitted box hugs the arm and the lens (the icon's square background is gone).
    expect(result.spec.viewBox[0]).toBeGreaterThan(140);
    expect(result.spec.viewBox[2]).toBeLessThan(150);
    const withMargin = assembleLogo(withBackground, choices, true, 0.1);
    expect(withMargin.ok && withMargin.spec.viewBox[2]).toBeGreaterThan(result.spec.viewBox[2]);
  });

  it("keeps the file's viewBox without centring", () => {
    const result = assembleLogo(withBackground, [], false, 0.2);
    expect(result.ok && result.spec.viewBox).toEqual([40, 40, 300, 300]);
  });

  it("refuses a logo of cut-outs only", () => {
    const result = assembleLogo(APP_LOGO_SPEC, APP_LOGO_SPEC.shapes.map(() => ({ role: "cutout" as const, omit: false })), true, 0);
    expect(result.ok).toBe(false);
  });
});

describe("activating", () => {
  const A = "a";
  const B = "b";
  const N = "new";

  it("ticks every target that showed the logo active so far", () => {
    const logos = [
      { id: A, targets: ["app_login", "dashboard"] as const },
      { id: N, targets: [] as const },
    ];
    expect(defaultTargets(logos, N)).toEqual(["app_login", "dashboard"]);
  });

  it("only the targets of the logo of the app login when they differ", () => {
    const logos = [
      { id: A, targets: ["app_login"] as const },
      { id: B, targets: ["dashboard"] as const },
      { id: N, targets: [] as const },
    ];
    expect(defaultTargets(logos, N)).toEqual(["app_login"]);
  });

  it("never offers a target that already shows this logo", () => {
    const logos = [
      { id: N, targets: ["app_login"] as const },
      { id: B, targets: ["dashboard"] as const },
    ];
    expect(defaultTargets(logos, N)).toEqual(["dashboard"]);
  });
});

describe("names and deleting", () => {
  it("duplicate names stay within 40 characters", () => {
    expect(duplicateName("App-Logo")).toBe("Kopie von App-Logo");
    expect(duplicateName("x".repeat(40)).length).toBeLessThanOrEqual(40);
  });

  it("built-in and active logos can't be deleted", () => {
    expect(deleteBlocker({ kind: "builtin", targets: [] })).not.toBeNull();
    expect(deleteBlocker({ kind: "uploaded", targets: ["dashboard"] })).not.toBeNull();
    expect(deleteBlocker({ kind: "uploaded", targets: [] })).toBeNull();
  });
});
