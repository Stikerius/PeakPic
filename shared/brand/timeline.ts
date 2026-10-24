// The logo animation as a pure function: progress of the loop (0..1) -> what to draw. Worklets, so
// the app computes each frame on the UI thread; the dashboard uses the same function.
//
// Standard loop (8 s, approved, see STANDARD_PARAMS):
//   0-30 %  outline is drawn (dash 1 -> 0, cubic-bezier(0.45,0,0.2,1))
//  25-42 %  fill fades in (opacity 0 -> 1, scale 0.97 -> 1, ease-out)
//  36-48 %  outline fades out
//  40-62 %  dot wave (scale 0.15 -> 6, opacity 0 -> 0.95 at 42 % -> 0, cubic-bezier(0.2,0.6,0.3,1))
//  42-62 %  shine crosses the logo
//  50-80 %  breathing (scale 1 -> 1.02 at 65 % -> 1)
//  82-95 %  the logo fades out, 95-100 % pause
// The parameters move these phases proportionally (drawPortion and hold); if the loop would run
// past 95 %, all phases are compressed to fit.

import { clamp01, ease, segment } from "./easing";
import type { PresetParams } from "./presets";

export type BrandTimeline = {
  drawEnd: number;
  fillStart: number;
  fillEnd: number;
  strokeOutStart: number;
  strokeOutEnd: number;
  waveStart: number;
  wavePeak: number;
  waveEnd: number;
  shineStart: number;
  shineEnd: number;
  breatheStart: number;
  breathePeak: number;
  breatheEnd: number;
  exitStart: number;
  exitEnd: number;
};

const LOOP_END = 0.95;

function round6(value: number): number {
  "worklet";
  return Math.round(value * 1e6) / 1e6;
}

export function brandTimeline(params: PresetParams): BrandTimeline {
  "worklet";
  const d = params.drawPortion;
  const exitStart = d + 0.32 + params.hold;
  const exitEnd = exitStart + 0.13;
  const raw: BrandTimeline = {
    drawEnd: d,
    fillStart: d - 0.05,
    fillEnd: d + 0.12,
    strokeOutStart: d + 0.06,
    strokeOutEnd: d + 0.18,
    waveStart: d + 0.1,
    wavePeak: d + 0.12,
    waveEnd: d + 0.32,
    shineStart: d + 0.12,
    shineEnd: d + 0.32,
    breatheStart: d + 0.2,
    breathePeak: (d + 0.2 + exitStart - 0.02) / 2,
    breatheEnd: exitStart - 0.02,
    exitStart,
    exitEnd,
  };
  const factor = round6(exitEnd) > LOOP_END ? LOOP_END / exitEnd : 1;
  return {
    drawEnd: round6(raw.drawEnd * factor),
    fillStart: round6(raw.fillStart * factor),
    fillEnd: round6(raw.fillEnd * factor),
    strokeOutStart: round6(raw.strokeOutStart * factor),
    strokeOutEnd: round6(raw.strokeOutEnd * factor),
    waveStart: round6(raw.waveStart * factor),
    wavePeak: round6(raw.wavePeak * factor),
    waveEnd: round6(raw.waveEnd * factor),
    shineStart: round6(raw.shineStart * factor),
    shineEnd: round6(raw.shineEnd * factor),
    breatheStart: round6(raw.breatheStart * factor),
    breathePeak: round6(raw.breathePeak * factor),
    breatheEnd: round6(raw.breatheEnd * factor),
    exitStart: round6(raw.exitStart * factor),
    exitEnd: round6(raw.exitEnd * factor),
  };
}

export type BrandFrame = {
  /** Dash offset of the outline, normalized: 1 = nothing drawn, 0 = complete. */
  strokeOffset: number;
  strokeOpacity: number;
  fillOpacity: number;
  fillScale: number;
  /** Wipes: how much of the fill is uncovered (1 = all). */
  fillReveal: number;
  waveScale: number;
  waveOpacity: number;
  /** Position of the shine across the logo, 0 (left, outside) -> 1 (right, outside). */
  shine: number;
  shineOpacity: number;
  logoScale: number;
  logoOpacity: number;
};

/** Ring of the dot wave: radius and (constant) line width in stage units. */
export const WAVE_RADIUS = 60;
export const WAVE_LINE_WIDTH = 90;
const WAVE_START_SCALE = 0.15;
const SHINE_PEAK = 0.55;

export function brandFrame(progress: number, params: PresetParams, timeline: BrandTimeline): BrandFrame {
  "worklet";
  const p = clamp01(progress);
  const t = timeline;
  const style = params.easing;

  // Outline.
  const drawn = params.drawLine ? ease(style, "draw", segment(p, 0, t.drawEnd)) : 1;
  let strokeOpacity = params.drawLine || !params.fill ? 1 : 0;
  if (params.fill) strokeOpacity *= 1 - segment(p, t.strokeOutStart, t.strokeOutEnd);

  // Fill.
  const fillT = segment(p, t.fillStart, t.fillEnd);
  const fillEased = ease(style, "fill", fillT);
  let fillOpacity = 0;
  let fillScale = 1;
  let fillReveal = 1;
  if (params.fill) {
    if (params.fillMode === "fade") {
      fillOpacity = fillEased;
      fillScale = 0.97 + 0.03 * fillEased;
    } else if (params.fillMode === "bloom") {
      fillOpacity = fillEased;
      fillScale = 0.85 + 0.15 * fillEased;
    } else {
      fillOpacity = fillT > 0 ? 1 : 0;
      fillReveal = fillEased;
    }
  }

  // Wave.
  let waveOpacity = 0;
  let waveScale = WAVE_START_SCALE;
  if (params.wave && p >= t.waveStart && p <= t.waveEnd) {
    waveScale = WAVE_START_SCALE + (params.waveScale - WAVE_START_SCALE) * ease(style, "wave", segment(p, t.waveStart, t.waveEnd));
    waveOpacity =
      p <= t.wavePeak
        ? params.waveStrength * segment(p, t.waveStart, t.wavePeak)
        : params.waveStrength * (1 - segment(p, t.wavePeak, t.waveEnd));
  }

  // Shine.
  const inShine = params.shine && params.fill && p >= t.shineStart && p <= t.shineEnd;
  const shine = inShine ? ease(style, "inOut", segment(p, t.shineStart, t.shineEnd)) : 0;
  const shineOpacity = inShine ? SHINE_PEAK : 0;

  // Breathing.
  let logoScale = 1;
  if (params.breathe && p > t.breatheStart && p < t.breatheEnd) {
    const amount = params.breatheStrength / 100;
    logoScale =
      p <= t.breathePeak
        ? 1 + amount * ease(style, "inOut", segment(p, t.breatheStart, t.breathePeak))
        : 1 + amount * ease(style, "inOut", 1 - segment(p, t.breathePeak, t.breatheEnd));
  }

  // Leaving.
  let logoOpacity = 1;
  if (params.exit !== "none") {
    const exitT = segment(p, t.exitStart, t.exitEnd);
    logoOpacity = 1 - exitT;
    if (params.exit === "shrink") logoScale *= 1 - 0.4 * ease(style, "inOut", exitT);
  }

  return {
    strokeOffset: 1 - drawn,
    strokeOpacity,
    fillOpacity,
    fillScale,
    fillReveal,
    waveScale,
    waveOpacity,
    shine,
    shineOpacity,
    logoScale,
    logoOpacity,
  };
}

/** The calm still image (reduced motion, animation off): the finished logo, no wave, no shine. */
export function stillFrame(params: PresetParams): BrandFrame {
  "worklet";
  return {
    strokeOffset: 0,
    strokeOpacity: params.fill ? 0 : 1,
    fillOpacity: params.fill ? 1 : 0,
    fillScale: 1,
    fillReveal: 1,
    waveScale: WAVE_START_SCALE,
    waveOpacity: 0,
    shine: 0,
    shineOpacity: 0,
    logoScale: 1,
    logoOpacity: 1,
  };
}
