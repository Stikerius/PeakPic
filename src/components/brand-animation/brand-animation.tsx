import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, AppState, Platform, StyleSheet } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedKeyboard,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Mask, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import {
  COST_LIMITS,
  RING_RADIUS,
  RING_WIDTH,
  STANDARD_ANIMATION,
  WAVE_START,
  animationCost,
  animationFeatures,
  evaluateFrame,
  limitAnimation,
  parseAnimation,
  shapeLayout,
  sparkAt,
  sparkLayout,
  stillAnimFrame,
  type AnimFrame,
  type Spark,
} from "../../../shared/brand/animation";
import type { PublicDesignConfig } from "../../../shared/brand/config";
import { APP_LOGO_SPEC, shapeLength, validateLogoSpec, type LogoShape, type LogoSpec } from "../../../shared/brand/logoSpec";
import { animationPalette, frameColor } from "../../../shared/brand/palettes";
import { shineGeometry, shineX } from "../../../shared/brand/timeline";
import { LogoShapeElement, OutlineShape } from "@/components/brand-animation/logo-shapes";
import { brandColors, brandMask, brandShine, type ColorScheme } from "@/constants/theme";

/** The logo box is 120 units wide; dot spacing, line widths, waves and sparks are in these units. */
const LOGO_UNITS = 120;
/** Frame watch: after this many frames, too many slow frames step down one level. */
const WATCH_FRAMES = 120;
const SLOW_FRAME_MS = 24;
const SLOW_SHARE = 0.25;
/** Opacity of the whole animation while the keyboard is open. */
const KEYBOARD_OPACITY = 0.3;

type BrandAnimationProps = {
  config: PublicDesignConfig;
  scheme: ColorScheme;
  /** Screen background the dot raster fades into at the edge. */
  background: string;
  width: number;
  height: number;
  /** Side of the square the logo is fitted into. */
  logoSize: number;
  logoCenterY: number;
};

/**
 * "Bewegung reduzieren" of the system, live: Reanimated's useReducedMotion only reads it once at
 * app start, so switching it while the app is open would change nothing.
 */
function useReduceMotionLive(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return active;
}

/** Rect of a wipe in viewBox units: 0 none, 1 up, 2 down, 3 left, 4 right. */
function wipeRect(vb: readonly [number, number, number, number], wipe: number, reveal: number) {
  "worklet";
  const [x, y, w, h] = vb;
  if (wipe === 1) return { x, y: y + h * (1 - reveal), width: w, height: h * reveal };
  if (wipe === 2) return { x, y, width: w, height: h * reveal };
  if (wipe === 3) return { x, y, width: w * reveal, height: h };
  if (wipe === 4) return { x: x + w * (1 - reveal), y, width: w * reveal, height: h };
  return { x, y, width: w, height: h };
}

/**
 * The active logo as a looping background animation (Animation v2, see shared/brand/animation.ts;
 * the values per frame come from the same function as in the dashboard). Purely decorative: no
 * touches, hidden from accessibility, drawn behind the content. Pauses when the app or the screen
 * isn't active; with "reduce motion" or the animation switched off it shows the finished logo as
 * a still image. If the device can't keep up, it steps down to lighter levels (fewer sparks and
 * waves, no shine, wider dots) without changing the course of the animation.
 */
/**
 * Height of the software keyboard. The browser has none (Reanimated warns there), so the web
 * build uses a constant 0; the choice is fixed per platform, the hook order never changes.
 */
const useKeyboardHeight: () => { height: SharedValue<number> } =
  Platform.OS === "web"
    ? function useNoKeyboard() {
        return { height: useSharedValue(0) };
      }
    : useAnimatedKeyboard;

export function BrandAnimation({ config, scheme, background, width, height, logoSize, logoCenterY }: BrandAnimationProps) {
  // Checked again before drawing; anything wrong falls back to the built-in logo / standard.
  const spec: LogoSpec = useMemo(() => {
    const checked = validateLogoSpec(config.logo);
    return checked.ok ? checked.spec : APP_LOGO_SPEC;
  }, [config.logo]);
  const parsed = useMemo(() => parseAnimation(config.preset) ?? STANDARD_ANIMATION, [config.preset]);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const startLevel: 0 | 1 = animationCost(parsed, spec.shapes.length) > COST_LIMITS.soft ? 1 : 0;
  const shownLevel = Math.max(level, startLevel) as 0 | 1 | 2;
  const anim = useMemo(() => limitAnimation(parsed, shownLevel), [parsed, shownLevel]);
  const layout = useMemo(() => shapeLayout(spec), [spec]);
  const features = useMemo(() => animationFeatures(anim, spec.shapes.length), [anim, spec]);
  // Dash lengths in each shape's own units (the transform is applied to the element).
  const lengths = useMemo(() => spec.shapes.map((shape) => shapeLength(shape, false)), [spec]);
  const sparks = useMemo(() => features.sparks.map((s) => sparkLayout(s.count, s.seed)), [features]);
  const colors = useMemo(() => brandColors(config.palette, scheme, config.colors), [config.palette, scheme, config.colors]);
  const swatches = useMemo(() => animationPalette(colors, scheme), [colors, scheme]);
  const perShape = features.perShape;

  const reducedMotion = useReduceMotionLive();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const moving = config.animation && !reducedMotion && focused && appActive;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (!moving) {
      cancelAnimation(progress);
      return;
    }
    progress.set(0);
    // Reduce motion is handled here (live); Reanimated's own handling only knows the start value.
    progress.set(
      withRepeat(
        withTiming(1, { duration: anim.duration * 1000, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
        -1,
        false,
        undefined,
        ReduceMotion.Never,
      ),
    );
    return () => cancelAnimation(progress);
  }, [moving, anim.duration, progress]);

  const frame = useDerivedValue(
    () => (moving ? evaluateFrame(anim, progress.get(), layout, perShape) : stillAnimFrame(anim, layout, perShape)),
    [moving, anim, layout, perShape],
  );

  // Frame watch: windows of frames after the start; too many slow ones -> one level lighter.
  const frames = useSharedValue(0);
  const slowFrames = useSharedValue(0);
  const [watched, setWatched] = useState(false);
  function onWatched(tooSlow: boolean) {
    if (tooSlow && shownLevel < 2) setLevel((shownLevel + 1) as 1 | 2);
    else setWatched(true);
  }
  const watch = useFrameCallback((info) => {
    const dt = info.timeSincePreviousFrame;
    if (dt === null) return;
    frames.set(frames.get() + 1);
    if (dt > SLOW_FRAME_MS) slowFrames.set(slowFrames.get() + 1);
    if (frames.get() >= WATCH_FRAMES) {
      const tooSlow = slowFrames.get() > WATCH_FRAMES * SLOW_SHARE;
      frames.set(0);
      slowFrames.set(0);
      scheduleOnRN(onWatched, tooSlow);
    }
  }, false);
  useEffect(() => {
    watch.setActive(moving && !watched);
    return () => watch.setActive(false);
  }, [moving, watched, watch]);

  // Geometry: stage in points, the logo in its own viewBox units.
  const unit = logoSize / LOGO_UNITS;
  const cx = width / 2;
  const cy = logoCenterY;
  const [vbX, vbY, vbW, vbH] = spec.viewBox;
  const pxPerVb = logoSize / Math.max(vbW, vbH);
  const strokeVb = (anim.strokeWidth * unit) / pxPerVb;
  const dots = features.dots;
  const spacing = (dots?.spacing ?? 18) * unit;
  const edgeRadius = Math.max(cx, width - cx, cy, height - cy, 1);
  const shineWidth = ((features.shine?.width ?? 50) * unit) / pxPerVb;
  const shineAngle = features.shine?.angle ?? 0;
  const shineBox = shineGeometry(spec.viewBox, shineWidth, shineAngle);
  const vb = spec.viewBox;

  // Keyboard open: the whole animation dims, the loop keeps running.
  const keyboard = useKeyboardHeight();
  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(keyboard.height.get(), [0, 120], [1, KEYBOARD_OPACITY], "clamp"),
  }));
  const logoStyle = useAnimatedStyle(() => {
    const f = frame.get();
    return {
      opacity: f.logoOpacity,
      transform: [{ translateX: f.logoDx * unit }, { translateY: f.logoDy * unit }, { rotate: `${f.logoRotate}deg` }, { scale: f.logoScale }],
    };
  });
  const fillStyle = useAnimatedStyle(() => ({
    opacity: frame.get().fillOpacity,
    transform: [{ scale: frame.get().fillScale }],
  }));
  const strokeStyle = useAnimatedStyle(() => ({ opacity: frame.get().strokeOpacity, transform: [{ scale: frame.get().strokeScale }] }));

  const glowProps = useAnimatedProps(() => ({ opacity: frame.get().dotsGlow }));
  const spreadProps = useAnimatedProps(() => {
    const s = frame.get().dotsSpread;
    return { r: LOGO_UNITS * unit * s, opacity: s > 0 ? 1 - s : 0 };
  });
  const fillRectProps = useAnimatedProps(() => wipeRect(vb, frame.get().fillWipe, frame.get().fillReveal));
  // Wipe plus colour change (only used when a colour track exists).
  const fillRectColorProps = useAnimatedProps(() => {
    const f = frame.get();
    return { ...wipeRect(vb, f.fillWipe, f.fillReveal), fill: frameColor(swatches, f.colorFrom, f.colorTo, f.colorMix) };
  });
  const shineProps = useAnimatedProps(() => ({
    x: shineX(shineBox, frame.get().shine),
    opacity: frame.get().shineOpacity,
  }));

  const fills = spec.shapes.map((shape, i) => ({ shape, i })).filter(({ shape }) => shape.role !== "cutout");
  const cutouts = spec.shapes.map((shape, i) => ({ shape, i })).filter(({ shape }) => shape.role === "cutout");
  const shapeMask = (
    <Mask id="brandLogoMask" maskUnits="userSpaceOnUse" x={vbX} y={vbY} width={vbW} height={vbH}>
      <Rect x={vbX} y={vbY} width={vbW} height={vbH} fill={brandMask.hide} />
      {spec.shapes.map((shape, i) =>
        shape.role === "stroke" ? null : <LogoShapeElement key={i} shape={shape} paint={{ fill: shape.role === "fill" ? brandMask.show : brandMask.hide }} />,
      )}
    </Mask>
  );
  const shineGradient = (
    <LinearGradient id="brandShine" x1={0} y1={0} x2={1} y2={0}>
      <Stop offset={0} stopColor={brandShine} stopOpacity={0} />
      <Stop offset={0.5} stopColor={brandShine} stopOpacity={1} />
      <Stop offset={1} stopColor={brandShine} stopOpacity={0} />
    </LinearGradient>
  );
  const shineLayer =
    features.shine !== null ? (
      <G transform={`rotate(${shineAngle} ${vbX + vbW / 2} ${vbY + vbH / 2})`}>
        <AnimatedRect x={shineBox.startX} y={shineBox.y} width={shineWidth} height={shineBox.height} fill="url(#brandShine)" animatedProps={shineProps} />
      </G>
    ) : null;
  // Centre of each shape in points inside the logo box (origin of its own rotation and scale).
  const offsetX = (logoSize - vbW * pxPerVb) / 2;
  const offsetY = (logoSize - vbH * pxPerVb) / 2;
  const origin = (i: number): [number, number] => {
    const [sx, sy] = layout.centers[i] ?? [vbX + vbW / 2, vbY + vbH / 2];
    return [offsetX + (sx - vbX) * pxPerVb, offsetY + (sy - vbY) * pxPerVb];
  };

  return (
    <Animated.View
      style={[styles.root, { width, height }, rootStyle]}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height}>
        <Defs>
          <Pattern id="brandDotsMuted" patternUnits="userSpaceOnUse" x={cx - spacing / 2} y={cy - spacing / 2} width={spacing} height={spacing}>
            <Circle cx={spacing / 2} cy={spacing / 2} r={(dots?.radius ?? 1) * unit} fill={colors.mutedDot} />
          </Pattern>
          <Pattern id="brandDotsLit" patternUnits="userSpaceOnUse" x={cx - spacing / 2} y={cy - spacing / 2} width={spacing} height={spacing}>
            <Circle cx={spacing / 2} cy={spacing / 2} r={(dots?.glowRadius ?? 1.6) * unit} fill={colors.accent} />
          </Pattern>
          <RadialGradient id="brandEdge" cx={cx} cy={cy} rx={edgeRadius} ry={edgeRadius} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
            <Stop offset={dots?.fade ?? 0.35} stopColor={background} stopOpacity={0} />
            <Stop offset={1} stopColor={background} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        {dots !== null && <Rect x={0} y={0} width={width} height={height} fill="url(#brandDotsMuted)" />}
        {dots !== null && dots.variant === "glow" && (
          <AnimatedRect x={0} y={0} width={width} height={height} fill="url(#brandDotsLit)" animatedProps={glowProps} />
        )}
        {dots !== null && dots.variant === "gradient" && <AnimatedCircle cx={cx} cy={cy} fill="url(#brandDotsLit)" animatedProps={spreadProps} />}
        {/* Waves: rings of constant width that uncover the lit dot raster where they pass. */}
        {dots !== null &&
          Array.from({ length: features.waves }, (_, k) => <WaveRing key={k} index={k} frame={frame} cx={cx} cy={cy} unit={unit} />)}
        <Rect x={0} y={0} width={width} height={height} fill="url(#brandEdge)" />
        {sparks.map((list, k) =>
          list.map((spark, j) => (
            <SparkDot
              key={`${k}-${j}`}
              track={k}
              spark={spark}
              distance={features.sparks[k]?.distance ?? 1}
              size={features.sparks[k]?.size ?? 1}
              frame={frame}
              cx={cx}
              cy={cy}
              unit={unit}
              color={colors.accent}
            />
          )),
        )}
      </Svg>

      <Animated.View style={[styles.logo, { left: cx - logoSize / 2, top: cy - logoSize / 2, width: logoSize, height: logoSize }, logoStyle]}>
        {features.hasFill && (
          <Animated.View style={[StyleSheet.absoluteFill, fillStyle]}>
            {perShape ? (
              <>
                {fills.map(({ shape, i }) => (
                  <ShapeFill
                    key={i}
                    index={i}
                    shape={shape}
                    cutouts={cutouts.map((c) => c.shape)}
                    frame={frame}
                    size={logoSize}
                    vb={vb}
                    origin={origin(i)}
                    unit={unit}
                    strokeWidth={shape.strokeWidth ?? strokeVb}
                    swatches={swatches}
                  />
                ))}
                {shineLayer !== null && (
                  <Svg style={StyleSheet.absoluteFill} width={logoSize} height={logoSize} viewBox={vb.join(" ")}>
                    <Defs>
                      {shapeMask}
                      {shineGradient}
                    </Defs>
                    <G mask="url(#brandLogoMask)">{shineLayer}</G>
                  </Svg>
                )}
              </>
            ) : (
              <Svg width={logoSize} height={logoSize} viewBox={vb.join(" ")}>
                <Defs>
                  {/* Fills white, cut-outs black: the cut-outs stay transparent, never painted over. */}
                  {shapeMask}
                  {shineGradient}
                </Defs>
                <G mask="url(#brandLogoMask)">
                  {features.color ? (
                    <AnimatedRect animatedProps={fillRectColorProps} />
                  ) : (
                    <AnimatedRect fill={colors.accent} animatedProps={fillRectProps} />
                  )}
                  {shineLayer}
                </G>
                {spec.shapes.map((shape, i) =>
                  shape.role === "stroke" ? (
                    <LogoShapeElement key={i} shape={shape} paint={{ fill: "none", stroke: colors.accent, strokeWidth: shape.strokeWidth ?? strokeVb }} />
                  ) : null,
                )}
              </Svg>
            )}
          </Animated.View>
        )}
        {features.hasDraw && (
          <Animated.View style={[StyleSheet.absoluteFill, strokeStyle]}>
            {perShape ? (
              spec.shapes.map((shape, i) => (
                <ShapeView key={i} index={i} frame={frame} origin={origin(i)} unit={unit} part="outline">
                  <Svg width={logoSize} height={logoSize} viewBox={vb.join(" ")}>
                    <OutlineShape shape={shape} index={i} length={lengths[i] ?? 1} frame={frame} color={colors.accent} swatches={features.color ? swatches : null} strokeWidth={strokeVb} />
                  </Svg>
                </ShapeView>
              ))
            ) : (
              <Svg width={logoSize} height={logoSize} viewBox={vb.join(" ")}>
                {spec.shapes.map((shape, i) => (
                  <OutlineShape key={i} shape={shape} index={i} length={lengths[i] ?? 1} frame={frame} color={colors.accent} swatches={features.color ? swatches : null} strokeWidth={strokeVb} />
                ))}
              </Svg>
            )}
          </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

function WaveRing({ index, frame, cx, cy, unit }: { index: number; frame: SharedValue<AnimFrame>; cx: number; cy: number; unit: number }) {
  const props = useAnimatedProps(() => {
    const w = frame.get().waves[index];
    return { r: RING_RADIUS * unit * (w?.scale ?? WAVE_START), opacity: w?.opacity ?? 0 };
  });
  return <AnimatedCircle cx={cx} cy={cy} fill="none" stroke="url(#brandDotsLit)" strokeWidth={RING_WIDTH * unit} animatedProps={props} />;
}

function SparkDot({
  track,
  spark,
  distance,
  size,
  frame,
  cx,
  cy,
  unit,
  color,
}: {
  track: number;
  spark: Spark;
  distance: number;
  size: number;
  frame: SharedValue<AnimFrame>;
  cx: number;
  cy: number;
  unit: number;
  color: string;
}) {
  const props = useAnimatedProps(() => {
    const at = sparkAt(spark, distance, size, frame.get().sparks[track] ?? -1);
    return { cx: cx + at.x * unit, cy: cy + at.y * unit, r: at.r * unit, opacity: at.opacity };
  });
  return <AnimatedCircle fill={color} animatedProps={props} />;
}

/**
 * One shape in its own layer, moved, turned and scaled about its own centre (tracks on single
 * shapes). `part` decides which opacity applies: the fill's or the outline's.
 */
function ShapeView({
  index,
  frame,
  origin,
  unit,
  part,
  children,
}: {
  index: number;
  frame: SharedValue<AnimFrame>;
  origin: [number, number];
  unit: number;
  part: "fill" | "outline";
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const s = frame.get().shapes[index];
    if (s === undefined) return { opacity: 1, transform: [] };
    return {
      opacity: s.opacity * (part === "fill" ? s.fillOpacity : s.outlineOpacity),
      transform: [{ translateX: s.dx * unit }, { translateY: s.dy * unit }, { rotate: `${s.rotate}deg` }, { scale: s.scale }],
    };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [origin[0], origin[1], 0] }, style]}>{children}</Animated.View>;
}

function ShapeFill({
  index,
  shape,
  cutouts,
  frame,
  size,
  vb,
  origin,
  unit,
  strokeWidth,
  swatches,
}: {
  index: number;
  shape: LogoShape;
  cutouts: LogoShape[];
  frame: SharedValue<AnimFrame>;
  size: number;
  vb: readonly [number, number, number, number];
  origin: [number, number];
  unit: number;
  strokeWidth: number;
  swatches: readonly string[];
}) {
  const [x, y, w, h] = vb;
  const rectProps = useAnimatedProps(() => {
    const s = frame.get().shapes[index];
    const rect = wipeRect(vb, s?.wipe ?? 0, s?.reveal ?? 1);
    return { ...rect, fill: frameColor(swatches, s?.colorFrom ?? 0, s?.colorTo ?? 0, s?.colorMix ?? 0) };
  });
  const strokeProps = useAnimatedProps(() => {
    const s = frame.get().shapes[index];
    return { stroke: frameColor(swatches, s?.colorFrom ?? 0, s?.colorTo ?? 0, s?.colorMix ?? 0) };
  });
  return (
    <ShapeView index={index} frame={frame} origin={origin} unit={unit} part="fill">
      <Svg width={size} height={size} viewBox={vb.join(" ")}>
        <Defs>
          <ClipPath id="shapeClip">
            <LogoShapeElement shape={shape} paint={{}} />
          </ClipPath>
          <Mask id="cutMask" maskUnits="userSpaceOnUse" x={x - w} y={y - h} width={w * 3} height={h * 3}>
            <Rect x={x - w} y={y - h} width={w * 3} height={h * 3} fill={brandMask.show} />
            {cutouts.map((c, i) => (
              <LogoShapeElement key={i} shape={c} paint={{ fill: brandMask.hide }} />
            ))}
          </Mask>
        </Defs>
        <G mask="url(#cutMask)">
          {shape.role === "stroke" ? (
            <AnimatedShapeStroke shape={shape} strokeWidth={strokeWidth} animatedProps={strokeProps} />
          ) : (
            <AnimatedRect clipPath="url(#shapeClip)" animatedProps={rectProps} />
          )}
        </G>
      </Svg>
    </ShapeView>
  );
}

/** A line shape whose colour follows the frame (only lines need a stroke colour). */
function AnimatedShapeStroke({ shape, strokeWidth, animatedProps }: { shape: LogoShape; strokeWidth: number; animatedProps: Partial<{ stroke: string }> }) {
  return (
    <AnimatedG animatedProps={animatedProps}>
      <LogoShapeElement shape={shape} paint={{ fill: "none", strokeWidth }} />
    </AnimatedG>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedG = Animated.createAnimatedComponent(G);

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
  },
  logo: {
    position: "absolute",
  },
});
