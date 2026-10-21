import { Canvas, Circle, LinearGradient, vec } from "@shopify/react-native-skia";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { storyRingGradient } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

export type StoryRingState = "unseen" | "seen" | "none";

const UNSEEN_WIDTH = 3;
const SEEN_WIDTH = 1.5;
/** Space between the ring and the avatar inside it. */
export const STORY_RING_GAP = 3;
/** Total ring thickness around an avatar (ring + gap), so callers can size the outer box. */
export const STORY_RING_INSET = UNSEEN_WIDTH + STORY_RING_GAP;

type StoryRingProps = {
  /** Outer diameter, ring included. */
  size: number;
  state: StoryRingState;
  children: ReactNode;
};

/** Accent gradient ring for unseen stories, a thin grey one once everything has been seen. */
export function StoryRing({ size, state, children }: StoryRingProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const strokeWidth = state === "unseen" ? UNSEEN_WIDTH : SEEN_WIDTH;
  const center = size / 2;
  // Both rings share their outer edge, so the avatar doesn't jump when the state changes.
  const r = center - strokeWidth / 2;

  return (
    <View style={[styles.ring, { width: size, height: size }]}>
      {state !== "none" && (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Circle
            cx={center}
            cy={center}
            r={r}
            style="stroke"
            strokeWidth={strokeWidth}
            color={state === "seen" ? colors.border : undefined}
          >
            {state === "unseen" && (
              <LinearGradient start={vec(0, size)} end={vec(size, 0)} colors={[...storyRingGradient]} />
            )}
          </Circle>
        </Canvas>
      )}
      {children}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    ring: {
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
