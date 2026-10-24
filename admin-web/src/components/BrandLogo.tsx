import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";

import {
  APP_LOGO_SPEC,
  BRAND_MASK,
  BRAND_SHINE,
  RING_RADIUS,
  RING_WIDTH,
  STANDARD_ANIMATION,
  WAVE_START,
  animationCost,
  animationFeatures,
  animationPalette,
  brandColors,
  COST_LIMITS,
  evaluateFrame,
  frameColor,
  isIdentity,
  limitAnimation,
  matrixAttribute,
  parseAnimation,
  pointsAttribute,
  shapeLayout,
  shapeLength,
  shineGeometry,
  shineX,
  sparkAt,
  sparkLayout,
  stillAnimFrame,
  validateLogoSpec,
  type AnimFrame,
  type AnimationSpec,
  type BrandMode,
  type BrandPaletteName,
  type ColorSetValues,
  type LogoShape,
  type LogoSpec,
} from "../lib/brand";
import { useAppearance } from "../lib/appearanceContext";

/** Stage: 240 units, the logo box is the middle 120 (as in the app, where the logo box is 120 units). */
const STAGE = 240;
const BOX = 120;
const CENTER = STAGE / 2;
const WATCH_FRAMES = 120;
const SLOW_FRAME_MS = 24;

/** A playhead from outside (the animation editor): the loop position 0..1, with change events. */
export type Clock = { get: () => number; subscribe: (onChange: () => void) => () => void };

type BrandLogoProps = {
  spec: unknown;
  /** Animation v2 (or v1 parameters, converted); anything invalid shows the standard. */
  animation: unknown;
  palette: BrandPaletteName;
  mode: BrandMode;
  /** Side in CSS pixels. */
  size: number;
  /** Loop running (otherwise the still image, or `progress`). */
  playing?: boolean;
  /** A fixed point of the loop (timeline scrubbing); wins over `playing`. */
  progress?: number | null;
  /** The editor's playhead; wins over `progress` and `playing`. */
  clock?: Clock | null;
  /** Show the dot raster, waves and sparks. */
  dots?: boolean;
  /** Change it to start the loop from the beginning. */
  restartKey?: number;
  /** Fill the stage with the palette's background (previews). */
  background?: boolean;
  className?: string;
  /** Colour set for "Hauptfarbe" (previews); default: the dashboard's active one. */
  colorSet?: ColorSetValues;
  /** Shape to mark with a dashed outline (editor's shape list). */
  highlight?: number | null;
  /** Show the still image (editor's "Standbild-Test" and "Bewegung reduzieren" preview). */
  still?: boolean;
};

/** One shape as a React SVG element (never raw markup). */
function shapeElement(shape: LogoShape, key: string, props: Record<string, string | number | undefined>): ReactElement {
  const transform = isIdentity(shape.transform) ? undefined : matrixAttribute(shape.transform);
  const common = { transform, fillRule: shape.fillRule, clipRule: shape.fillRule, ...props };
  switch (shape.type) {
    case "path":
      return <path key={key} d={shape.d} {...common} />;
    case "circle":
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
    case "ellipse":
      return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
    case "rect":
      return <rect key={key} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} {...common} />;
    case "line":
      return <line key={key} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...common} />;
    case "polygon":
      return <polygon key={key} points={pointsAttribute(shape.points)} {...common} />;
    case "polyline":
      return <polyline key={key} points={pointsAttribute(shape.points)} {...common} />;
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

/** The animation of a stored or received value: v2 checked, v1 converted, else the standard. */
export function useAnimation(value: unknown): AnimationSpec {
  return useMemo(() => parseAnimation(value) ?? STANDARD_ANIMATION, [value]);
}

function scaleAbout(scale: number): string {
  return `translate(${CENTER} ${CENTER}) scale(${scale}) translate(${-CENTER} ${-CENTER})`;
}

/** Rect of a wipe in viewBox units: 0 none, 1 up, 2 down, 3 left, 4 right. */
function wipeRect(vb: readonly [number, number, number, number], wipe: number, reveal: number): [number, number, number, number] {
  const [x, y, w, h] = vb;
  if (wipe === 1) return [x, y + h * (1 - reveal), w, h * reveal];
  if (wipe === 2) return [x, y, w, h * reveal];
  if (wipe === 3) return [x, y, w * reveal, h];
  if (wipe === 4) return [x + w * (1 - reveal), y, w * reveal, h];
  return [x, y, w, h];
}

function setRect(el: Element, [x, y, w, h]: [number, number, number, number]) {
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("width", String(Math.max(0, w)));
  el.setAttribute("height", String(Math.max(0, h)));
}

/**
 * The logo animation of the dashboard (login page, loading screen, previews, editor). Decorative
 * only: aria-hidden, never focusable, no pointer events. Frames are written straight into SVG
 * attributes (no React render per frame); paused while the tab is hidden; a still image with
 * "reduce motion"; steps down to lighter levels by itself if frames are too slow (fewer sparks
 * and waves, no shine), the course of the animation stays.
 */
export function BrandLogo({
  spec: specIn,
  animation: animationIn,
  palette,
  mode,
  size,
  playing = false,
  progress = null,
  clock = null,
  dots = true,
  restartKey = 0,
  background = false,
  className,
  colorSet,
  highlight = null,
  still = false,
}: BrandLogoProps) {
  const appearance = useAppearance();
  const spec: LogoSpec = useMemo(() => {
    const checked = validateLogoSpec(specIn);
    return checked.ok ? checked.spec : APP_LOGO_SPEC;
  }, [specIn]);
  const parsed = useAnimation(animationIn);
  // Start lighter right away when the estimate is above the warning (the editor shows why).
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const startLevel: 0 | 1 = animationCost(parsed, spec.shapes.length) > COST_LIMITS.soft ? 1 : 0;
  const shownLevel = Math.max(level, startLevel) as 0 | 1 | 2;
  const anim = useMemo(() => limitAnimation(parsed, shownLevel), [parsed, shownLevel]);
  const layout = useMemo(() => shapeLayout(spec), [spec]);
  const features = useMemo(() => animationFeatures(anim, spec.shapes.length), [anim, spec]);
  const lengths = useMemo(() => spec.shapes.map((s) => shapeLength(s, false)), [spec]);
  const sparks = useMemo(() => features.sparks.map((s) => sparkLayout(s.count, s.seed)), [features]);
  const activeSet = colorSet ?? appearance.colorSet;
  const colors = useMemo(() => brandColors(palette, mode, activeSet), [palette, mode, activeSet]);
  const swatches = useMemo(() => animationPalette(colors, mode), [colors, mode]);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reducedMotion = useReducedMotion();
  const root = useRef<SVGSVGElement>(null);

  const [vbX, vbY, vbW, vbH] = spec.viewBox;
  const vbPerUnit = Math.max(vbW, vbH) / BOX;
  const strokeVb = anim.strokeWidth * vbPerUnit;
  const shineWidth = (features.shine?.width ?? 50) * vbPerUnit;
  const shineAngle = features.shine?.angle ?? 0;
  const shineBox = useMemo(() => shineGeometry([vbX, vbY, vbW, vbH], shineWidth, shineAngle), [vbX, vbY, vbW, vbH, shineWidth, shineAngle]);
  const perShape = features.perShape;
  const showDots = dots && features.dots !== null;

  useEffect(() => {
    const svg = root.current;
    if (svg === null) return;
    const q = (selector: string) => svg.querySelector(selector);
    const all = (selector: string) => Array.from(svg.querySelectorAll(selector));
    const logo = q("[data-logo]");
    const fill = q("[data-fill]");
    const fillRect = q("[data-fill-rect]");
    const fillColored = all("[data-fill-color]");
    const outline = q("[data-outline]");
    const outlines = all("[data-outline-shape]");
    const shine = q("[data-shine]");
    const glow = q("[data-glow]");
    const spread = q("[data-spread]");
    const waves = all("[data-wave]");
    const sparkDots = all("[data-spark]");
    const shapeFills = all("[data-shape-fill]");
    const shapeRects = all("[data-shape-rect]");
    const shapeStrokes = all("[data-shape-stroke]");
    const shapeOutlines = all("[data-shape-outline]");
    const vb: [number, number, number, number] = [vbX, vbY, vbW, vbH];

    function shapeTransform(i: number, s: AnimFrame["shapes"][number]): string {
      const [cx, cy] = layout.centers[i] ?? [vbX + vbW / 2, vbY + vbH / 2];
      return `translate(${s.dx * vbPerUnit} ${s.dy * vbPerUnit}) rotate(${s.rotate} ${cx} ${cy}) translate(${cx} ${cy}) scale(${s.scale}) translate(${-cx} ${-cy})`;
    }

    function apply(frame: AnimFrame) {
      logo?.setAttribute(
        "transform",
        `translate(${frame.logoDx} ${frame.logoDy}) rotate(${frame.logoRotate} ${CENTER} ${CENTER}) ${scaleAbout(frame.logoScale)}`,
      );
      logo?.setAttribute("opacity", String(frame.logoOpacity));
      fill?.setAttribute("transform", scaleAbout(frame.fillScale));
      fill?.setAttribute("opacity", String(frame.fillOpacity));
      if (fillRect !== null) setRect(fillRect, wipeRect(vb, frame.fillWipe, frame.fillReveal));
      const color = frameColor(swatches, frame.colorFrom, frame.colorTo, frame.colorMix);
      fillColored.forEach((el) => el.setAttribute(el.getAttribute("data-fill-color") === "stroke" ? "stroke" : "fill", color));
      outline?.setAttribute("transform", scaleAbout(frame.strokeScale));
      outline?.setAttribute("opacity", String(frame.strokeOpacity));
      outlines.forEach((el) => {
        const i = Number(el.getAttribute("data-outline-shape"));
        const shape = frame.shapes[i];
        const drawn = shape !== undefined ? shape.draw : 1 - frame.strokeOffset;
        el.setAttribute("stroke-dashoffset", String((lengths[i] ?? 1) * (1 - drawn)));
        el.setAttribute("stroke", shape !== undefined ? frameColor(swatches, shape.colorFrom, shape.colorTo, shape.colorMix) : color);
      });
      if (shine !== null) {
        shine.setAttribute("x", String(shineX(shineBox, frame.shine)));
        shine.setAttribute("opacity", String(frame.shineOpacity));
      }
      glow?.setAttribute("opacity", String(frame.dotsGlow));
      if (spread !== null) {
        spread.setAttribute("r", String(CENTER * frame.dotsSpread));
        spread.setAttribute("opacity", String(frame.dotsSpread > 0 ? 1 - frame.dotsSpread : 0));
      }
      waves.forEach((el, k) => {
        const w = frame.waves[k];
        el.setAttribute("r", String(RING_RADIUS * (w?.scale ?? WAVE_START)));
        el.setAttribute("opacity", String(w?.opacity ?? 0));
      });
      sparkDots.forEach((el) => {
        const [k, j] = (el.getAttribute("data-spark") ?? "0-0").split("-").map(Number);
        const track = features.sparks[k ?? 0];
        const spark = sparks[k ?? 0]?.[j ?? 0];
        if (track === undefined || spark === undefined) return;
        const at = sparkAt(spark, track.distance, track.size, frame.sparks[k ?? 0] ?? -1);
        el.setAttribute("cx", String(CENTER + at.x));
        el.setAttribute("cy", String(CENTER + at.y));
        el.setAttribute("r", String(at.r));
        el.setAttribute("opacity", String(at.opacity));
        el.setAttribute("fill", color);
      });
      shapeFills.forEach((el) => {
        const i = Number(el.getAttribute("data-shape-fill"));
        const s = frame.shapes[i];
        if (s === undefined) return;
        el.setAttribute("transform", shapeTransform(i, s));
        el.setAttribute("opacity", String(s.opacity * s.fillOpacity));
      });
      shapeRects.forEach((el) => {
        const i = Number(el.getAttribute("data-shape-rect"));
        const s = frame.shapes[i];
        if (s === undefined) return;
        setRect(el, wipeRect(vb, s.wipe, s.reveal));
        el.setAttribute("fill", frameColor(swatches, s.colorFrom, s.colorTo, s.colorMix));
      });
      shapeStrokes.forEach((el) => {
        const s = frame.shapes[Number(el.getAttribute("data-shape-stroke"))];
        if (s !== undefined) el.setAttribute("stroke", frameColor(swatches, s.colorFrom, s.colorTo, s.colorMix));
      });
      shapeOutlines.forEach((el) => {
        const i = Number(el.getAttribute("data-shape-outline"));
        const s = frame.shapes[i];
        if (s === undefined) return;
        el.setAttribute("transform", shapeTransform(i, s));
        el.setAttribute("opacity", String(s.opacity * s.outlineOpacity));
      });
    }

    const stillImage = () => apply(stillAnimFrame(anim, layout, perShape));
    if (still) {
      stillImage();
      return;
    }
    if (clock !== null) {
      const update = () => apply(evaluateFrame(anim, clock.get(), layout, perShape));
      update();
      return clock.subscribe(update);
    }
    if (progress !== null) {
      apply(evaluateFrame(anim, progress, layout, perShape));
      return;
    }
    if (!playing || reducedMotion) {
      stillImage();
      return;
    }

    let raf = 0;
    let start: number | null = null;
    let last: number | null = null;
    let frames = 0;
    let slowFrames = 0;
    let pausedAt: number | null = null;
    const duration = anim.duration * 1000;

    const tick = (now: number) => {
      if (start === null) start = now;
      if (last !== null && frames < WATCH_FRAMES) {
        frames += 1;
        if (now - last > SLOW_FRAME_MS) slowFrames += 1;
        if (frames === WATCH_FRAMES && slowFrames > WATCH_FRAMES / 4 && shownLevel < 2) setLevel((shownLevel + 1) as 1 | 2);
      }
      last = now;
      apply(evaluateFrame(anim, ((now - start) % duration) / duration, layout, perShape));
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
  }, [anim, layout, perShape, features, sparks, swatches, lengths, playing, progress, clock, still, reducedMotion, restartKey, shineBox, vbX, vbY, vbW, vbH, vbPerUnit, shownLevel]);

  const box = (STAGE - BOX) / 2;
  const dotsSpec = features.dots;
  const fills = spec.shapes.map((shape, i) => ({ shape, i })).filter(({ shape }) => shape.role !== "cutout");
  const nested = (children: ReactElement | ReactElement[] | null) => (
    <svg x={box} y={box} width={BOX} height={BOX} viewBox={spec.viewBox.join(" ")} overflow="visible">
      {children}
    </svg>
  );

  return (
    <svg
      ref={root}
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${STAGE} ${STAGE}`}
      aria-hidden="true"
      focusable="false"
      pointerEvents="none"
    >
      <defs>
        {dotsSpec !== null && (
          <>
            <pattern id={`${id}-dots`} patternUnits="userSpaceOnUse" x={CENTER - dotsSpec.spacing / 2} y={CENTER - dotsSpec.spacing / 2} width={dotsSpec.spacing} height={dotsSpec.spacing}>
              <circle cx={dotsSpec.spacing / 2} cy={dotsSpec.spacing / 2} r={dotsSpec.radius} fill={colors.mutedDot} />
            </pattern>
            <pattern id={`${id}-lit`} patternUnits="userSpaceOnUse" x={CENTER - dotsSpec.spacing / 2} y={CENTER - dotsSpec.spacing / 2} width={dotsSpec.spacing} height={dotsSpec.spacing}>
              <circle cx={dotsSpec.spacing / 2} cy={dotsSpec.spacing / 2} r={dotsSpec.glowRadius} fill={colors.accent} />
            </pattern>
            <radialGradient id={`${id}-fade`} cx={CENTER} cy={CENTER} r={CENTER} gradientUnits="userSpaceOnUse">
              <stop offset={dotsSpec.fade} stopColor={BRAND_MASK.show} stopOpacity={1} />
              <stop offset={1} stopColor={BRAND_MASK.show} stopOpacity={0} />
            </radialGradient>
            <mask id={`${id}-edge`} maskUnits="userSpaceOnUse" x={0} y={0} width={STAGE} height={STAGE}>
              <rect x={0} y={0} width={STAGE} height={STAGE} fill={`url(#${id}-fade)`} />
            </mask>
          </>
        )}
        <mask id={`${id}-shape`} maskUnits="userSpaceOnUse" x={vbX} y={vbY} width={vbW} height={vbH}>
          <rect x={vbX} y={vbY} width={vbW} height={vbH} fill={BRAND_MASK.hide} />
          {spec.shapes.map((shape, i) =>
            shape.role === "stroke" ? null : shapeElement(shape, `m${i}`, { fill: shape.role === "fill" ? BRAND_MASK.show : BRAND_MASK.hide }),
          )}
        </mask>
        {perShape && (
          <>
            {/* Cut-outs stay transparent even when single shapes move. */}
            <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x={vbX - vbW} y={vbY - vbH} width={vbW * 3} height={vbH * 3}>
              <rect x={vbX - vbW} y={vbY - vbH} width={vbW * 3} height={vbH * 3} fill={BRAND_MASK.show} />
              {spec.shapes.map((shape, i) => (shape.role === "cutout" ? shapeElement(shape, `c${i}`, { fill: BRAND_MASK.hide }) : null))}
            </mask>
            {fills.map(({ shape, i }) => (
              <clipPath key={`clip${i}`} id={`${id}-clip${i}`}>
                {shapeElement(shape, `k${i}`, {})}
              </clipPath>
            ))}
          </>
        )}
        <linearGradient id={`${id}-shine`} x1={0} y1={0} x2={1} y2={0}>
          <stop offset={0} stopColor={BRAND_SHINE} stopOpacity={0} />
          <stop offset={0.5} stopColor={BRAND_SHINE} stopOpacity={1} />
          <stop offset={1} stopColor={BRAND_SHINE} stopOpacity={0} />
        </linearGradient>
      </defs>

      {background && <rect x={0} y={0} width={STAGE} height={STAGE} fill={colors.background} />}

      {showDots && dotsSpec !== null && (
        <g mask={`url(#${id}-edge)`}>
          <rect x={0} y={0} width={STAGE} height={STAGE} fill={`url(#${id}-dots)`} />
          {dotsSpec.variant === "glow" ? (
            <rect data-glow="" x={0} y={0} width={STAGE} height={STAGE} fill={`url(#${id}-lit)`} opacity={0} />
          ) : (
            <circle data-spread="" cx={CENTER} cy={CENTER} r={0} fill={`url(#${id}-lit)`} opacity={0} />
          )}
          {Array.from({ length: features.waves }, (_, k) => (
            <circle key={k} data-wave={k} cx={CENTER} cy={CENTER} r={RING_RADIUS * WAVE_START} fill="none" stroke={`url(#${id}-lit)`} strokeWidth={RING_WIDTH} opacity={0} />
          ))}
        </g>
      )}

      {dots &&
        sparks.map((list, k) => list.map((_, j) => <circle key={`${k}-${j}`} data-spark={`${k}-${j}`} cx={CENTER} cy={CENTER} r={0} opacity={0} fill={colors.accent} />))}

      <g data-logo="">
        {features.hasFill && (
          <g data-fill="">
            {nested(
              perShape ? (
                <>
                  <g mask={`url(#${id}-cut)`}>
                    {fills.map(({ shape, i }) => (
                      <g key={i} data-shape-fill={i}>
                        {shape.role === "stroke" ? (
                          shapeElement(shape, `sf${i}`, {
                            fill: "none",
                            stroke: colors.accent,
                            strokeWidth: shape.strokeWidth ?? strokeVb,
                            strokeLinecap: "round",
                            strokeLinejoin: "round",
                            "data-shape-stroke": i,
                          })
                        ) : (
                          <rect data-shape-rect={i} x={vbX} y={vbY} width={vbW} height={vbH} fill={colors.accent} clipPath={`url(#${id}-clip${i})`} />
                        )}
                      </g>
                    ))}
                  </g>
                  {features.shine !== null && (
                    <g mask={`url(#${id}-shape)`}>
                      <g transform={`rotate(${shineAngle} ${vbX + vbW / 2} ${vbY + vbH / 2})`}>
                        <rect data-shine="" x={shineBox.startX} y={shineBox.y} width={shineWidth} height={shineBox.height} fill={`url(#${id}-shine)`} opacity={0} />
                      </g>
                    </g>
                  )}
                </>
              ) : (
                <>
                  <g mask={`url(#${id}-shape)`}>
                    <rect data-fill-rect="" data-fill-color="fill" x={vbX} y={vbY} width={vbW} height={vbH} fill={colors.accent} />
                    {features.shine !== null && (
                      <g transform={`rotate(${shineAngle} ${vbX + vbW / 2} ${vbY + vbH / 2})`}>
                        <rect data-shine="" x={shineBox.startX} y={shineBox.y} width={shineWidth} height={shineBox.height} fill={`url(#${id}-shine)`} opacity={0} />
                      </g>
                    )}
                  </g>
                  {spec.shapes.map((shape, i) =>
                    shape.role === "stroke"
                      ? shapeElement(shape, `s${i}`, {
                          fill: "none",
                          stroke: colors.accent,
                          strokeWidth: shape.strokeWidth ?? strokeVb,
                          strokeLinecap: "round",
                          strokeLinejoin: "round",
                          "data-fill-color": "stroke",
                        })
                      : null,
                  )}
                </>
              ),
            )}
          </g>
        )}
        <g data-outline="" opacity={0}>
          {nested(
            spec.shapes.map((shape, i) => (
              <g key={i} data-shape-outline={perShape ? i : undefined}>
                {shapeElement(shape, `o${i}`, {
                  fill: "none",
                  stroke: colors.accent,
                  strokeWidth: shape.strokeWidth ?? strokeVb,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  strokeDasharray: `${lengths[i] ?? 1} ${lengths[i] ?? 1}`,
                  strokeDashoffset: 0,
                  "data-outline-shape": i,
                })}
              </g>
            )),
          )}
        </g>
        {highlight !== null && spec.shapes[highlight] !== undefined &&
          nested(
            shapeElement(spec.shapes[highlight], "hl", {
              fill: "none",
              stroke: colors.accent,
              strokeWidth: 1.5 * vbPerUnit,
              strokeDasharray: `${4 * vbPerUnit} ${3 * vbPerUnit}`,
              opacity: 0.9,
            }),
          )}
      </g>
    </svg>
  );
}
