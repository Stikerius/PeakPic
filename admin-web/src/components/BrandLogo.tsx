import { useEffect, useId, useMemo, useRef, useSyncExternalStore, type ReactElement } from "react";

import {
  APP_LOGO_SPEC,
  BRAND_MASK,
  BRAND_SHINE,
  STANDARD_PARAMS,
  WAVE_LINE_WIDTH,
  WAVE_RADIUS,
  brandColors,
  brandFrame,
  brandTimeline,
  isIdentity,
  matrixAttribute,
  pointsAttribute,
  shapeLength,
  stillFrame,
  validateLogoSpec,
  validatePresetParams,
  type BrandFrame,
  type BrandMode,
  type BrandPaletteName,
  type LogoShape,
  type LogoSpec,
  type PresetParams,
} from "../lib/brand";

/** Stage: 240 units, the logo box is the middle 120 (as in the app, where the logo box is 120 units). */
const STAGE = 240;
const BOX = 120;
const CENTER = STAGE / 2;
const MAX_DRAWN_SHAPES = 24;
const WATCH_FRAMES = 120;
const SLOW_FRAME_MS = 24;

type BrandLogoProps = {
  spec: unknown;
  params: unknown;
  palette: BrandPaletteName;
  mode: BrandMode;
  /** Side in CSS pixels. */
  size: number;
  /** Loop running (otherwise the still image, or `progress`). */
  playing?: boolean;
  /** A fixed point of the loop (timeline scrubbing); wins over `playing`. */
  progress?: number | null;
  /** Show the dot raster and the wave. */
  dots?: boolean;
  /** Change it to start the loop from the beginning. */
  restartKey?: number;
  /** Fill the stage with the palette's background (previews). */
  background?: boolean;
  className?: string;
};

type Refs = {
  ring: SVGCircleElement | null;
  logo: SVGGElement | null;
  fill: SVGGElement | null;
  fillRect: SVGRectElement | null;
  shine: SVGRectElement | null;
  stroke: SVGGElement | null;
};

function scaleAbout(scale: number): string {
  return `translate(${CENTER} ${CENTER}) scale(${scale}) translate(${-CENTER} ${-CENTER})`;
}

/** One shape as a React SVG element (never raw markup). */
function shapeElement(shape: LogoShape, key: string, props: Record<string, string | number | undefined>): ReactElement {
  const transform = isIdentity(shape.transform) ? undefined : matrixAttribute(shape.transform);
  const common = { key, transform, fillRule: shape.fillRule, ...props };
  switch (shape.type) {
    case "path":
      return <path d={shape.d} {...common} />;
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
    case "ellipse":
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} {...common} />;
    case "line":
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...common} />;
    case "polygon":
      return <polygon points={pointsAttribute(shape.points)} {...common} />;
    case "polyline":
      return <polyline points={pointsAttribute(shape.points)} {...common} />;
  }
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** "Bewegung reduzieren" of the system, live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}

/**
 * The logo animation of the dashboard (login page, loading screen, previews). Decorative only:
 * aria-hidden, never focusable, no pointer events. Frames are written straight into SVG
 * attributes (no React render per frame); paused while the tab is hidden; a still image with
 * "reduce motion"; drops wave and shine by itself if frames are too slow.
 */
export function BrandLogo({
  spec: specIn,
  params: paramsIn,
  palette,
  mode,
  size,
  playing = false,
  progress = null,
  dots = true,
  restartKey = 0,
  background = false,
  className,
}: BrandLogoProps) {
  const spec: LogoSpec = useMemo(() => {
    const checked = validateLogoSpec(specIn);
    return checked.ok ? checked.spec : APP_LOGO_SPEC;
  }, [specIn]);
  const params: PresetParams = useMemo(() => {
    const checked = validatePresetParams(paramsIn);
    const base = checked.ok ? checked.params : STANDARD_PARAMS;
    return spec.shapes.length > MAX_DRAWN_SHAPES ? { ...base, drawLine: false } : base;
  }, [paramsIn, spec]);
  const timeline = useMemo(() => brandTimeline(params), [params]);
  const lengths = useMemo(() => spec.shapes.map((s) => shapeLength(s, false)), [spec]);
  const colors = brandColors(palette, mode);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reducedMotion = useReducedMotion();
  const refs = useRef<Refs>({ ring: null, logo: null, fill: null, fillRect: null, shine: null, stroke: null });
  const simple = useRef(false);

  const [vbX, vbY, vbW, vbH] = spec.viewBox;
  const vbPerUnit = Math.max(vbW, vbH) / BOX;
  const strokeVb = params.strokeWidth * vbPerUnit;
  const shineWidth = params.shineWidth * vbPerUnit;
  const wipe = params.fillMode === "wipeUp" || params.fillMode === "wipeLeft";

  useEffect(() => {
    // The outlines in shape order (marked with data-outline).
    const outlines = Array.from(refs.current.stroke?.querySelectorAll<SVGGeometryElement>("[data-outline]") ?? []);
    function apply(frame: BrandFrame) {
      const r = refs.current;
      const showWave = params.wave && !simple.current;
      r.ring?.setAttribute("r", String(WAVE_RADIUS * frame.waveScale));
      r.ring?.setAttribute("opacity", String(showWave ? frame.waveOpacity : 0));
      r.logo?.setAttribute("transform", scaleAbout(frame.logoScale));
      r.logo?.setAttribute("opacity", String(frame.logoOpacity));
      r.fill?.setAttribute("transform", scaleAbout(frame.fillScale));
      r.fill?.setAttribute("opacity", String(frame.fillOpacity));
      if (r.fillRect !== null && wipe) {
        const reveal = frame.fillReveal;
        if (params.fillMode === "wipeUp") {
          r.fillRect.setAttribute("y", String(vbY + vbH * (1 - reveal)));
          r.fillRect.setAttribute("height", String(vbH * reveal));
        } else {
          r.fillRect.setAttribute("width", String(vbW * reveal));
        }
      }
      r.shine?.setAttribute("x", String(vbX - shineWidth * 1.5 + (vbW + shineWidth * 2) * frame.shine));
      r.shine?.setAttribute("opacity", frame.shineOpacity > 0 && !simple.current ? "1" : "0");
      r.stroke?.setAttribute("opacity", String(frame.strokeOpacity));
      outlines.forEach((el, i) => el.setAttribute("stroke-dashoffset", String((lengths[i] ?? 1) * frame.strokeOffset)));
    }

    if (progress !== null) {
      apply(brandFrame(progress, params, timeline));
      return;
    }
    if (!playing || reducedMotion) {
      apply(stillFrame(params));
      return;
    }

    let raf = 0;
    let start: number | null = null;
    let last: number | null = null;
    let frames = 0;
    let slowFrames = 0;
    let pausedAt: number | null = null;
    const duration = params.duration * 1000;

    const tick = (now: number) => {
      if (start === null) start = now;
      if (last !== null && frames < WATCH_FRAMES) {
        frames += 1;
        if (now - last > SLOW_FRAME_MS) slowFrames += 1;
        if (frames === WATCH_FRAMES && slowFrames > WATCH_FRAMES / 4) simple.current = true;
      }
      last = now;
      apply(brandFrame(((now - start) % duration) / duration, params, timeline));
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        pausedAt = performance.now();
      } else {
        // Continue where it stopped, without a jump.
        if (pausedAt !== null && start !== null) start += performance.now() - pausedAt;
        pausedAt = null;
        last = null;
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) raf = requestAnimationFrame(tick);
    else pausedAt = performance.now();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [playing, progress, reducedMotion, params, timeline, lengths, restartKey, wipe, vbX, vbY, vbW, vbH, shineWidth]);

  const still = stillFrame(params);
  const box = (STAGE - BOX) / 2;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${STAGE} ${STAGE}`}
      aria-hidden="true"
      focusable="false"
      pointerEvents="none"
    >
      <defs>
        <pattern id={`${id}-dots`} patternUnits="userSpaceOnUse" x={CENTER - params.dotSpacing / 2} y={CENTER - params.dotSpacing / 2} width={params.dotSpacing} height={params.dotSpacing}>
          <circle cx={params.dotSpacing / 2} cy={params.dotSpacing / 2} r={params.dotRadius} fill={colors.mutedDot} />
        </pattern>
        <pattern id={`${id}-lit`} patternUnits="userSpaceOnUse" x={CENTER - params.dotSpacing / 2} y={CENTER - params.dotSpacing / 2} width={params.dotSpacing} height={params.dotSpacing}>
          <circle cx={params.dotSpacing / 2} cy={params.dotSpacing / 2} r={params.dotGlowRadius} fill={colors.accent} />
        </pattern>
        <radialGradient id={`${id}-fade`} cx={CENTER} cy={CENTER} r={CENTER} gradientUnits="userSpaceOnUse">
          <stop offset={params.dotFade} stopColor={BRAND_MASK.show} stopOpacity={1} />
          <stop offset={1} stopColor={BRAND_MASK.show} stopOpacity={0} />
        </radialGradient>
        <mask id={`${id}-edge`} maskUnits="userSpaceOnUse" x={0} y={0} width={STAGE} height={STAGE}>
          <rect x={0} y={0} width={STAGE} height={STAGE} fill={`url(#${id}-fade)`} />
        </mask>
        <mask id={`${id}-shape`} maskUnits="userSpaceOnUse" x={vbX} y={vbY} width={vbW} height={vbH}>
          <rect x={vbX} y={vbY} width={vbW} height={vbH} fill={BRAND_MASK.hide} />
          {spec.shapes.map((shape, i) =>
            shape.role === "stroke" ? null : shapeElement(shape, `m${i}`, { fill: shape.role === "fill" ? BRAND_MASK.show : BRAND_MASK.hide }),
          )}
        </mask>
        <linearGradient id={`${id}-shine`} x1={0} y1={0} x2={1} y2={0}>
          <stop offset={0} stopColor={BRAND_SHINE} stopOpacity={0} />
          <stop offset={0.5} stopColor={BRAND_SHINE} stopOpacity={0.55} />
          <stop offset={1} stopColor={BRAND_SHINE} stopOpacity={0} />
        </linearGradient>
      </defs>

      {background && <rect x={0} y={0} width={STAGE} height={STAGE} fill={colors.background} />}

      {dots && params.dots && (
        <g mask={`url(#${id}-edge)`}>
          <rect x={0} y={0} width={STAGE} height={STAGE} fill={`url(#${id}-dots)`} />
          {params.wave && (
            <circle
              ref={(el) => {
                refs.current.ring = el;
              }}
              cx={CENTER}
              cy={CENTER}
              r={WAVE_RADIUS * still.waveScale}
              fill="none"
              stroke={`url(#${id}-lit)`}
              strokeWidth={WAVE_LINE_WIDTH}
              opacity={0}
            />
          )}
        </g>
      )}

      <g
        ref={(el) => {
          refs.current.logo = el;
        }}
      >
        {params.fill && (
          <g
            ref={(el) => {
              refs.current.fill = el;
            }}
          >
            <svg x={box} y={box} width={BOX} height={BOX} viewBox={spec.viewBox.join(" ")} overflow="visible">
              <g mask={`url(#${id}-shape)`}>
                <rect
                  ref={(el) => {
                    refs.current.fillRect = el;
                  }}
                  x={vbX}
                  y={vbY}
                  width={vbW}
                  height={vbH}
                  fill={colors.accent}
                />
                {params.shine && (
                  <g transform={`rotate(${params.shineAngle} ${vbX + vbW / 2} ${vbY + vbH / 2})`}>
                    <rect
                      ref={(el) => {
                        refs.current.shine = el;
                      }}
                      x={vbX - shineWidth * 2}
                      y={vbY - vbH}
                      width={shineWidth}
                      height={vbH * 3}
                      fill={`url(#${id}-shine)`}
                      opacity={0}
                    />
                  </g>
                )}
              </g>
              {spec.shapes.map((shape, i) =>
                shape.role === "stroke"
                  ? shapeElement(shape, `s${i}`, { fill: "none", stroke: colors.accent, strokeWidth: shape.strokeWidth ?? strokeVb, strokeLinecap: "round", strokeLinejoin: "round" })
                  : null,
              )}
            </svg>
          </g>
        )}
        <g
          ref={(el) => {
            refs.current.stroke = el;
          }}
          opacity={still.strokeOpacity}
        >
          <svg x={box} y={box} width={BOX} height={BOX} viewBox={spec.viewBox.join(" ")} overflow="visible">
            {spec.shapes.map((shape, i) =>
              shapeElement(
                shape,
                `o${i}`,
                {
                  fill: "none",
                  stroke: colors.accent,
                  strokeWidth: shape.strokeWidth ?? strokeVb,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  strokeDasharray: `${lengths[i] ?? 1} ${lengths[i] ?? 1}`,
                  strokeDashoffset: 0,
                  "data-outline": i,
                },
              ),
            )}
          </svg>
        </g>
      </g>
    </svg>
  );
}
