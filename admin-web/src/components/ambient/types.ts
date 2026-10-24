import type { BrandMode, BrandPaletteName } from "../../lib/brand";

/**
 * Common interface of every background variant. Variants are plain SVG in a 1440 x 900 stage
 * (covering the window); all motion comes from CSS (transform and opacity only) and stops when
 * `active` is false or motion is reduced. Never interactive, never above content.
 */
export type AmbientProps = {
  active: boolean;
  mode: BrandMode;
  palette: BrandPaletteName;
  reducedMotion: boolean;
};

export const STAGE_VIEWBOX = "0 0 1440 900";
