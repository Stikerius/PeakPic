// Pure: which background animation a page gets and in which state it runs (unit tested in
// src/lib/__tests__/ambient.test.ts). The variants themselves are in components/ambient/.

import type { Ambient } from "./appearance";
import type { Route } from "./router";

export type AmbientVariant =
  | "contours" // Übersicht
  | "radar" // Warteschlange
  | "network" // Nutzer, Konto-Detail
  | "streams" // Nutzung
  | "ledger" // Audit-Log
  | "paper" // Rechtstexte, Offene Bestätigungen
  | "flight" // Mitteilungen
  | "hazard" // Bereinigung
  | "dots" // Logos, Design, Umfragen-Editor und -Auswertung: still, so the content stays in focus
  | "still"; // Meldungs-Detail: no motion at all for sensitive content

const BY_PAGE: Record<Route["page"], AmbientVariant> = {
  overview: "contours",
  queue: "radar",
  report: "still",
  users: "network",
  user: "network",
  usage: "streams",
  audit: "ledger",
  legal: "paper",
  "legal-edit": "paper",
  pending: "paper",
  reset: "hazard",
  "reset-job": "hazard",
  mail: "flight",
  "mail-campaign": "flight",
  logos: "dots",
  design: "dots",
  surveys: "streams",
  "survey-edit": "dots",
  "survey-results": "dots",
};

export function ambientFor(route: Route): AmbientVariant {
  return BY_PAGE[route.page];
}

/** Variants that never move, whatever is chosen. */
export const STILL_VARIANTS: readonly AmbientVariant[] = ["dots", "still"];

export type AmbientState = {
  /** Draw anything at all. */
  render: boolean;
  /** Animations running (otherwise a calm still image). */
  moving: boolean;
  /** Fewer layers after slow frames were measured. */
  level: "full" | "simple";
};

/**
 * "Aus": nothing. "Ruhig", reduce motion, a hidden tab or a variant without motion: the still
 * image. Slow frames: the simpler level.
 */
export function ambientState(input: { setting: Ambient; variant: AmbientVariant; reducedMotion: boolean; hidden: boolean; slow: boolean }): AmbientState {
  if (input.setting === "off" || input.variant === "still") return { render: false, moving: false, level: "full" };
  const moving = input.setting === "on" && !input.reducedMotion && !input.hidden && !STILL_VARIANTS.includes(input.variant);
  return { render: true, moving, level: input.slow ? "simple" : "full" };
}

/** After this many frames the background decides whether the device keeps up. */
export const WATCH_FRAMES = 90;
export const SLOW_FRAME_MS = 24;

/** Too many slow frames (more than a quarter) -> simpler level. */
export function tooSlow(frameTimes: readonly number[]): boolean {
  if (frameTimes.length < WATCH_FRAMES) return false;
  return frameTimes.filter((t) => t > SLOW_FRAME_MS).length > frameTimes.length / 4;
}
