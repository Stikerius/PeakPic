// Animation presets: parameters, their fixed ranges, the built-in presets and the check. The same
// ranges are enforced by public.brand_preset_params_valid() in supabase/schema.sql.

import type { EasingName } from "./easing";

export type FillMode = "fade" | "wipeUp" | "wipeLeft" | "bloom";
export type ExitMode = "fade" | "shrink" | "none";

export type PresetParams = {
  /** Seconds per loop. */
  duration: number;
  drawLine: boolean;
  /** Share of the loop the outline takes to draw. */
  drawPortion: number;
  strokeWidth: number;
  /** Fill the shapes at all (off: the outline stays, "Nur Zeichnen"). */
  fill: boolean;
  fillMode: FillMode;
  shine: boolean;
  shineWidth: number;
  /** Degrees. */
  shineAngle: number;
  wave: boolean;
  /** Highest opacity of the wave. */
  waveStrength: number;
  /** Scale the wave grows to. */
  waveScale: number;
  dots: boolean;
  dotSpacing: number;
  dotRadius: number;
  dotGlowRadius: number;
  /** Where the dot raster starts to fade towards the edge (share of the radius). */
  dotFade: number;
  breathe: boolean;
  /** Percent. */
  breatheStrength: number;
  /** Share of the loop the finished logo stays before it leaves. */
  hold: number;
  exit: ExitMode;
  easing: EasingName;
};

type NumberKey = { [K in keyof PresetParams]: PresetParams[K] extends number ? K : never }[keyof PresetParams];
type BooleanKey = { [K in keyof PresetParams]: PresetParams[K] extends boolean ? K : never }[keyof PresetParams];

export const PRESET_RANGES: Record<NumberKey, readonly [number, number]> = {
  duration: [4, 16],
  drawPortion: [0.1, 0.5],
  strokeWidth: [1, 6],
  shineWidth: [20, 120],
  shineAngle: [-30, 30],
  waveStrength: [0.3, 1],
  waveScale: [3, 8],
  dotSpacing: [12, 28],
  dotRadius: [0.8, 2.2],
  dotGlowRadius: [1.2, 2.6],
  dotFade: [0.2, 0.8],
  breatheStrength: [0, 4],
  hold: [0, 0.4],
};

export const PRESET_BOOLEANS: readonly BooleanKey[] = ["drawLine", "fill", "shine", "wave", "dots", "breathe"];

export const PRESET_CHOICES = {
  fillMode: ["fade", "wipeUp", "wipeLeft", "bloom"],
  exit: ["fade", "shrink", "none"],
  easing: ["smooth", "snappy", "linear"],
} as const satisfies Record<"fillMode" | "exit" | "easing", readonly string[]>;

/** The approved standard loop (8 seconds). Never change these values (see brandTimeline). */
export const STANDARD_PARAMS: PresetParams = {
  duration: 8,
  drawLine: true,
  drawPortion: 0.3,
  strokeWidth: 2.4,
  fill: true,
  fillMode: "fade",
  shine: true,
  shineWidth: 50,
  shineAngle: 12,
  wave: true,
  waveStrength: 0.95,
  waveScale: 6,
  dots: true,
  dotSpacing: 18,
  dotRadius: 1.1,
  dotGlowRadius: 1.6,
  dotFade: 0.35,
  breathe: true,
  breatheStrength: 2,
  hold: 0.2,
  exit: "fade",
  easing: "smooth",
};

export type BuiltinPreset = { id: string; name: string; params: PresetParams };

/** Same ids and values as the seeds in supabase/schema.sql (checked by a test). */
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  { id: "00000000-0000-4000-8000-00000000a001", name: "Standard", params: STANDARD_PARAMS },
  {
    id: "00000000-0000-4000-8000-00000000a002",
    name: "Ruhig",
    params: { ...STANDARD_PARAMS, duration: 10, drawLine: false, shine: false, wave: false, breathe: false },
  },
  {
    id: "00000000-0000-4000-8000-00000000a003",
    name: "Lebendig",
    params: {
      ...STANDARD_PARAMS,
      duration: 6,
      fillMode: "bloom",
      shineWidth: 70,
      waveStrength: 1,
      waveScale: 8,
      breatheStrength: 3,
      easing: "snappy",
    },
  },
  {
    id: "00000000-0000-4000-8000-00000000a004",
    name: "Nur Zeichnen",
    params: { ...STANDARD_PARAMS, drawPortion: 0.5, fill: false, shine: false, wave: false, breathe: false },
  },
];

export const STANDARD_PRESET_ID = "00000000-0000-4000-8000-00000000a001";

export type PresetCheck = { ok: true; params: PresetParams } | { ok: false; error: string };

/** Exactly the known keys, numbers within their ranges, known choices. */
export function validatePresetParams(value: unknown): PresetCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "Kein Objekt." };
  const input = value as Record<string, unknown>;
  const known = new Set<string>([...Object.keys(PRESET_RANGES), ...PRESET_BOOLEANS, ...Object.keys(PRESET_CHOICES)]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) return { ok: false, error: `Unbekannter Parameter: ${key.slice(0, 40)}` };
  }
  const result: Record<string, unknown> = {};
  for (const [key, [min, max]] of Object.entries(PRESET_RANGES)) {
    const n = input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
      return { ok: false, error: `${key} muss zwischen ${min} und ${max} liegen.` };
    }
    result[key] = n;
  }
  for (const key of PRESET_BOOLEANS) {
    if (typeof input[key] !== "boolean") return { ok: false, error: `${key} muss an oder aus sein.` };
    result[key] = input[key];
  }
  for (const [key, choices] of Object.entries(PRESET_CHOICES)) {
    const choice = input[key];
    if (typeof choice !== "string" || !(choices as readonly string[]).includes(choice)) {
      return { ok: false, error: `${key} hat einen unbekannten Wert.` };
    }
    result[key] = choice;
  }
  return { ok: true, params: result as PresetParams };
}
