import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { radius } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

export const BURST_HEART_SIZE = 96;
/** How long a burst lives; the owner removes it afterwards. */
export const BURST_DURATION_MS = 900;
export const BURST_PARTICLES = 7;

/** One heart burst at (x, y) of the photo. tilt and jitter are rolled when the tap happens. */
export type Burst = {
  id: number;
  x: number;
  y: number;
  /** -12 to +12 degrees. */
  tilt: number;
  /** Per particle: angle offset in radians and a distance factor (0.8 to 1.2). */
  jitter: { angle: number; distance: number }[];
};

let nextBurstId = 0;

/** A new burst at (x, y) with a random tilt and particle spread (rolled once, when tapping). */
export function createBurst(x: number, y: number): Burst {
  return {
    id: nextBurstId++,
    x,
    y,
    tilt: Math.random() * 24 - 12,
    jitter: Array.from({ length: BURST_PARTICLES }, () => ({
      angle: (Math.random() - 0.5) * 0.5,
      distance: 0.8 + Math.random() * 0.4,
    })),
  };
}

const PARTICLE_SIZE = 14;
const PARTICLE_DISTANCE = 80;

function Particle({ index, jitter, progress }: { index: number; jitter: Burst["jitter"][number]; progress: SharedValue<number> }) {
  const { colors } = useTheme();
  const angle = (index / BURST_PARTICLES) * Math.PI * 2 + jitter.angle;
  const distance = PARTICLE_DISTANCE * jitter.distance;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p < 0.15 ? p / 0.15 : Math.max(0, 1 - (p - 0.15) / 0.85),
      transform: [
        { translateX: Math.cos(angle) * distance * p },
        { translateY: Math.sin(angle) * distance * p },
        { scale: 0.6 + 0.4 * p },
      ],
    };
  });
  return (
    <Animated.View style={[particleStyles.particle, style]}>
      <Ionicons name="heart" size={PARTICLE_SIZE} color={colors.accent} />
    </Animated.View>
  );
}

const particleStyles = StyleSheet.create({
  particle: {
    position: "absolute",
    left: (BURST_HEART_SIZE - PARTICLE_SIZE) / 2,
    top: (BURST_HEART_SIZE - PARTICLE_SIZE) / 2,
  },
});

function HeartBurst({ burst, onDone }: { burst: Burst; onDone: (id: number) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0);
  const opacity = useSharedValue(0);
  const lift = useSharedValue(0);
  const ring = useSharedValue(0);
  const particles = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // Only a short fade in and out, no spring, tilt, ring or particles.
      opacity.value = withSequence(withTiming(1, { duration: 150 }), withDelay(250, withTiming(0, { duration: 200 })));
      return;
    }
    scale.value = withSequence(
      withTiming(1.25, { duration: 160, easing: Easing.out(Easing.cubic) }),
      withSpring(1, { damping: 10, stiffness: 220 }),
      withDelay(150, withTiming(1.35, { duration: 300 })),
    );
    opacity.value = withSequence(withTiming(1, { duration: 60 }), withDelay(440, withTiming(0, { duration: 300 })));
    lift.value = withDelay(500, withTiming(-70, { duration: 300, easing: Easing.in(Easing.quad) }));
    ring.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    particles.value = withDelay(80, withTiming(1, { duration: 560, easing: Easing.out(Easing.quad) }));
  }, [reduced, scale, opacity, lift, ring, particles]);

  // Removes itself when done; unmounting cancels the timer.
  useEffect(() => {
    const timer = setTimeout(() => onDone(burst.id), BURST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [burst.id, onDone]);

  const tilt = reduced ? 0 : burst.tilt;
  const heartStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }, { rotate: `${tilt}deg` }, { scale: scale.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - ring.value),
    transform: [{ scale: 0.5 + 1.3 * ring.value }],
  }));

  return (
    <View
      style={[styles.burst, { left: burst.x - BURST_HEART_SIZE / 2, top: burst.y - BURST_HEART_SIZE / 2 }]}
      pointerEvents="none"
    >
      {!reduced && (
        <>
          <Animated.View style={[styles.ring, ringStyle]} />
          {burst.jitter.map((jitter, index) => (
            <Particle key={index} index={index} jitter={jitter} progress={particles} />
          ))}
        </>
      )}
      <Animated.View style={[styles.heart, heartStyle]}>
        <Ionicons name="heart" size={BURST_HEART_SIZE} color={colors.accent} />
      </Animated.View>
    </View>
  );
}

type LikeBurstProps = {
  bursts: readonly Burst[];
  /** Hides the running bursts at once (a like the server refused); they still clean up. */
  hidden?: boolean;
  onDone: (id: number) => void;
};

/** Overlay with the running bursts; never takes touches. */
export function LikeBurst({ bursts, hidden = false, onDone }: LikeBurstProps) {
  if (bursts.length === 0) return null;
  return (
    <View style={[StyleSheet.absoluteFill, hidden && hiddenStyle.hidden]} pointerEvents="none">
      {bursts.map((burst) => (
        <HeartBurst key={burst.id} burst={burst} onDone={onDone} />
      ))}
    </View>
  );
}

const hiddenStyle = StyleSheet.create({ hidden: { opacity: 0 } });

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    burst: {
      position: "absolute",
      width: BURST_HEART_SIZE,
      height: BURST_HEART_SIZE,
    },
    heart: {
      position: "absolute",
      left: 0,
      top: 0,
    },
    ring: {
      position: "absolute",
      left: 0,
      top: 0,
      width: BURST_HEART_SIZE,
      height: BURST_HEART_SIZE,
      borderRadius: radius.full,
      borderWidth: 3,
      borderColor: colors.accent,
    },
  }),
);
