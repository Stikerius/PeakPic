import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedKeyboard,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, LinearGradient, Mask, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import type { PublicDesignConfig } from "../../../shared/brand/config";
import { APP_LOGO_SPEC, shapeLength, validateLogoSpec, type LogoSpec } from "../../../shared/brand/logoSpec";
import { STANDARD_PARAMS, validatePresetParams, type PresetParams } from "../../../shared/brand/presets";
import { WAVE_LINE_WIDTH, WAVE_RADIUS, brandFrame, brandTimeline, stillFrame } from "../../../shared/brand/timeline";
import { LogoShapeElement, OutlineShape } from "@/components/brand-animation/logo-shapes";
import { brandColors, brandMask, brandShine, type ColorScheme } from "@/constants/theme";

/** Logos with more shapes are faded in instead of drawn (one animated outline per shape). */
const MAX_DRAWN_SHAPES = 24;
/** The logo box is 120 units wide; dot spacing, line widths and the wave are in these units. */
const LOGO_UNITS = 120;
/** Frame watch: after this many frames, too many slow frames switch to the simple level. */
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

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return active;
}

/**
 * The active logo as a looping background animation (outline, fill, dot wave, shine, breathing),
 * see shared/brand/timeline.ts. Purely decorative: no touches, hidden from accessibility, drawn
 * behind the content. Pauses when the app or the screen isn't active; with "reduce motion" or
 * the animation switched off it shows the finished logo as a still image. If the device can't keep
 * up, it drops the wave and the shine by itself.
 */
export function BrandAnimation({ config, scheme, background, width, height, logoSize, logoCenterY }: BrandAnimationProps) {
  // Checked again before drawing; anything wrong falls back to the built-in logo / standard.
  const spec: LogoSpec = useMemo(() => {
    const checked = validateLogoSpec(config.logo);
    return checked.ok ? checked.spec : APP_LOGO_SPEC;
  }, [config.logo]);
  const params: PresetParams = useMemo(() => {
    const checked = validatePresetParams(config.preset);
    const base = checked.ok ? checked.params : STANDARD_PARAMS;
    return spec.shapes.length > MAX_DRAWN_SHAPES ? { ...base, drawLine: false } : base;
  }, [config.preset, spec]);
  const timeline = useMemo(() => brandTimeline(params), [params]);
  // Dash lengths in each shape's own units (the transform is applied to the element).
  const lengths = useMemo(() => spec.shapes.map((shape) => shapeLength(shape, false)), [spec]);
  const colors = brandColors(config.palette, scheme);

  const reducedMotion = useReducedMotion();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const [simple, setSimple] = useState(false);
  const moving = config.animation && !reducedMotion && focused && appActive;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (!moving) {
      cancelAnimation(progress);
      return;
    }
    progress.set(0);
    progress.set(withRepeat(withTiming(1, { duration: params.duration * 1000, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(progress);
  }, [moving, params.duration, progress]);

  const frame = useDerivedValue(
    () => (moving ? brandFrame(progress.get(), params, timeline) : stillFrame(params)),
    [moving, params, timeline],
  );

  // Frame watch: one window of frames after the start; too many slow ones -> simple level.
  const frames = useSharedValue(0);
  const slowFrames = useSharedValue(0);
  const [watched, setWatched] = useState(false);
  function onWatched(tooSlow: boolean) {
    if (tooSlow) setSimple(true);
    setWatched(true);
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

  // Keyboard open: the whole animation dims, the loop keeps running.
  const keyboard = useAnimatedKeyboard();
  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(keyboard.height.get(), [0, 120], [1, KEYBOARD_OPACITY], "clamp"),
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: frame.get().logoOpacity,
    transform: [{ scale: frame.get().logoScale }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: frame.get().fillOpacity,
    transform: [{ scale: frame.get().fillScale }],
  }));
  const strokeStyle = useAnimatedStyle(() => ({ opacity: frame.get().strokeOpacity }));

  // Geometry: stage in points, the logo in its own viewBox units.
  const unit = logoSize / LOGO_UNITS;
  const cx = width / 2;
  const cy = logoCenterY;
  const [vbX, vbY, vbW, vbH] = spec.viewBox;
  const pxPerVb = logoSize / Math.max(vbW, vbH);
  const strokeVb = (params.strokeWidth * unit) / pxPerVb;
  const spacing = params.dotSpacing * unit;
  const edgeRadius = Math.max(cx, width - cx, cy, height - cy, 1);
  const shineWidth = (params.shineWidth * unit) / pxPerVb;
  const showWave = params.wave && !simple;
  const showShine = params.shine && params.fill && !simple;
  const wipe = params.fillMode === "wipeUp" || params.fillMode === "wipeLeft";

  const ringProps = useAnimatedProps(() => ({
    r: WAVE_RADIUS * unit * frame.get().waveScale,
    opacity: frame.get().waveOpacity,
  }));
  const fillRectProps = useAnimatedProps(() => {
    const reveal = frame.get().fillReveal;
    return params.fillMode === "wipeUp"
      ? { x: vbX, y: vbY + vbH * (1 - reveal), width: vbW, height: vbH * reveal }
      : params.fillMode === "wipeLeft"
        ? { x: vbX, y: vbY, width: vbW * reveal, height: vbH }
        : { x: vbX, y: vbY, width: vbW, height: vbH };
  });
  const shineProps = useAnimatedProps(() => ({
    x: vbX - shineWidth * 1.5 + (vbW + shineWidth * 2) * frame.get().shine,
    opacity: frame.get().shineOpacity > 0 ? 1 : 0,
  }));

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
            <Circle cx={spacing / 2} cy={spacing / 2} r={params.dotRadius * unit} fill={colors.mutedDot} />
          </Pattern>
          <Pattern id="brandDotsLit" patternUnits="userSpaceOnUse" x={cx - spacing / 2} y={cy - spacing / 2} width={spacing} height={spacing}>
            <Circle cx={spacing / 2} cy={spacing / 2} r={params.dotGlowRadius * unit} fill={colors.accent} />
          </Pattern>
          <RadialGradient id="brandEdge" cx={cx} cy={cy} rx={edgeRadius} ry={edgeRadius} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
            <Stop offset={params.dotFade} stopColor={background} stopOpacity={0} />
            <Stop offset={1} stopColor={background} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        {params.dots && <Rect x={0} y={0} width={width} height={height} fill="url(#brandDotsMuted)" />}
        {/* The wave: a ring of constant width that uncovers the lit dot raster where it passes. */}
        {showWave && (
          <AnimatedCircle cx={cx} cy={cy} fill="none" stroke="url(#brandDotsLit)" strokeWidth={WAVE_LINE_WIDTH * unit} animatedProps={ringProps} />
        )}
        <Rect x={0} y={0} width={width} height={height} fill="url(#brandEdge)" />
      </Svg>

      <Animated.View style={[styles.logo, { left: cx - logoSize / 2, top: cy - logoSize / 2, width: logoSize, height: logoSize }, logoStyle]}>
        {params.fill && (
          <Animated.View style={[StyleSheet.absoluteFill, fillStyle]}>
            <Svg width={logoSize} height={logoSize} viewBox={spec.viewBox.join(" ")}>
              <Defs>
                {/* Fills white, cut-outs black: the cut-outs stay transparent, never painted over. */}
                <Mask id="brandLogoMask" maskUnits="userSpaceOnUse" x={vbX} y={vbY} width={vbW} height={vbH}>
                  <Rect x={vbX} y={vbY} width={vbW} height={vbH} fill={brandMask.hide} />
                  {spec.shapes.map((shape, i) =>
                    shape.role === "stroke" ? null : (
                      <LogoShapeElement key={i} shape={shape} paint={{ fill: shape.role === "fill" ? brandMask.show : brandMask.hide }} />
                    ),
                  )}
                </Mask>
                <LinearGradient id="brandShine" x1={0} y1={0} x2={1} y2={0}>
                  <Stop offset={0} stopColor={brandShine} stopOpacity={0} />
                  <Stop offset={0.5} stopColor={brandShine} stopOpacity={0.55} />
                  <Stop offset={1} stopColor={brandShine} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <G mask="url(#brandLogoMask)">
                {wipe ? (
                  <AnimatedRect fill={colors.accent} animatedProps={fillRectProps} />
                ) : (
                  <Rect x={vbX} y={vbY} width={vbW} height={vbH} fill={colors.accent} />
                )}
                {showShine && (
                  <G transform={`rotate(${params.shineAngle} ${vbX + vbW / 2} ${vbY + vbH / 2})`}>
                    <AnimatedRect y={vbY - vbH} width={shineWidth} height={vbH * 3} fill="url(#brandShine)" animatedProps={shineProps} />
                  </G>
                )}
              </G>
              {spec.shapes.map((shape, i) =>
                shape.role === "stroke" ? (
                  <LogoShapeElement key={i} shape={shape} paint={{ fill: "none", stroke: colors.accent, strokeWidth: shape.strokeWidth ?? strokeVb }} />
                ) : null,
              )}
            </Svg>
          </Animated.View>
        )}
        <Animated.View style={[StyleSheet.absoluteFill, strokeStyle]}>
          <Svg width={logoSize} height={logoSize} viewBox={spec.viewBox.join(" ")}>
            {spec.shapes.map((shape, i) => (
              <OutlineShape key={i} shape={shape} length={lengths[i] ?? 1} frame={frame} color={colors.accent} strokeWidth={strokeVb} />
            ))}
          </Svg>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

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
