import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Divider } from "@/components/ui/divider";
import { radius as radii, spacing } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";

type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Grey placeholder block with a slow, subtle pulse (static with Reduce Motion). */
export function Skeleton({ width = "100%", height, radius = radii.sm, style }: SkeletonProps) {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withRepeat(withTiming(0.5, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.block, { width, height, borderRadius: radius }, animatedStyle, style]} />;
}

type ListSkeletonProps = {
  rows?: number;
  /** Round placeholder on the left, like an avatar. */
  avatar?: boolean;
};

/** Loading state for a list: rows of avatar + two text lines, separated by hairlines. */
export function ListSkeleton({ rows = 6, avatar = true }: ListSkeletonProps) {
  const styles = useStyles();
  return (
    <View accessibilityLabel="Wird geladen" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index}>
          <View style={styles.row}>
            {avatar && <Skeleton width={44} height={44} radius={radii.full} />}
            <View style={styles.lines}>
              <Skeleton width={index % 2 === 0 ? "55%" : "40%"} height={14} />
              <Skeleton width={index % 2 === 0 ? "80%" : "65%"} height={12} />
            </View>
          </View>
          {index < rows - 1 && <Divider inset={avatar ? spacing.md + 44 + spacing.ms : spacing.md} />}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    block: {
      backgroundColor: colors.surfaceRaised,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
    },
    lines: {
      flex: 1,
      gap: spacing.sm,
    },
  }),
);
