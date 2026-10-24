// Pure logic of the logo library page (unit tested in src/lib/__tests__/logoLibrary.test.ts).

import { fitViewBox, validateLogoSpec, type LogoCheck, type LogoSpec, type ShapeRole } from "./brand";

export type DesignTarget = "app_login" | "dashboard";
export const DESIGN_TARGETS: readonly DesignTarget[] = ["app_login", "dashboard"];

export const MAX_SVG_BYTES = 200 * 1024;

/** Why a chosen file can't be checked, or null. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!/\.svg$/i.test(file.name)) return "Nur SVG-Dateien (.svg) sind erlaubt.";
  if (file.size === 0) return "Die Datei ist leer.";
  if (file.size > MAX_SVG_BYTES) return "Die Datei ist grösser als 200 KB.";
  return null;
}

export type ShapeChoice = { role: ShapeRole; omit: boolean };

/**
 * The logo from the imported shapes and the roles chosen in step 2: left-out shapes go, the
 * roles are applied, with "Auto-Zentrierung" the viewBox fits the visible shapes plus a margin
 * (share of the size). Checked with the same rules as on the server.
 */
export function assembleLogo(spec: LogoSpec, choices: readonly ShapeChoice[], centre: boolean, margin: number): LogoCheck {
  const shapes = spec.shapes
    .map((shape, i) => ({ shape, choice: choices[i] ?? { role: shape.role, omit: false } }))
    .filter(({ choice }) => !choice.omit)
    .map(({ shape, choice }) => ({ ...shape, role: choice.role }));
  const viewBox = centre ? (fitViewBox(shapes, margin) ?? spec.viewBox) : spec.viewBox;
  return validateLogoSpec({ version: spec.version, viewBox, shapes });
}

/**
 * Targets ticked by default when activating: every target that uses the logo active so far (the
 * one on the app login screen, else the dashboard's), so the new logo appears wherever the old
 * one was. Targets that already show this logo are not offered again.
 */
export function defaultTargets(logos: readonly { id: string; targets: readonly DesignTarget[] }[], logoId: string): DesignTarget[] {
  const activeOn = (target: DesignTarget) => logos.find((l) => l.targets.includes(target))?.id ?? null;
  const previous = activeOn("app_login") ?? activeOn("dashboard");
  const open = DESIGN_TARGETS.filter((t) => activeOn(t) !== logoId);
  const chosen = open.filter((t) => activeOn(t) === previous);
  return chosen.length > 0 ? chosen : open;
}

/** "Kopie von …" within the 40 characters a name may have. */
export function duplicateName(name: string): string {
  return `Kopie von ${name}`.slice(0, 40).trim();
}

/** Whether a logo may be deleted, and why not. */
export function deleteBlocker(logo: { kind: "builtin" | "uploaded"; targets: readonly DesignTarget[] }): string | null {
  if (logo.kind === "builtin") return "Eingebaute Logos lassen sich nicht löschen.";
  if (logo.targets.length > 0) return "Aktive Logos lassen sich nicht löschen.";
  return null;
}
