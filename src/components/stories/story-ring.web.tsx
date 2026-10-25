import { useId, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

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

/**
 * Web: the same ring as story-ring.tsx, drawn with SVG instead of Skia, so the feed and the
 * story bar don't need CanvasKit (it is only loaded for the photo editor).
 */
export function StoryRing({ size, state, children }: StoryRingProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const gradientId = `story-ring-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const strokeWidth = state === "unseen" ? UNSEEN_WIDTH : SEEN_WIDTH;
  const center = size / 2;
  const r = center - strokeWidth / 2;
  const stops = [...storyRingGradient];

  return (
    <View style={[styles.ring, { width: size, height: size }]}>
      {state !== "none" && (
        <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
          {state === "unseen" && (
            <Defs>
              {/* From the bottom left to the top right, as in the Skia version. */}
              <LinearGradient id={gradientId} x1="0" y1={size} x2={size} y2="0" gradientUnits="userSpaceOnUse">
                {stops.map((color, i) => (
                  <Stop key={i} offset={stops.length > 1 ? i / (stops.length - 1) : 0} stopColor={color} />
                ))}
              </LinearGradient>
            </Defs>
          )}
          <Circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            strokeWidth={strokeWidth}
            stroke={state === "seen" ? colors.border : `url(#${gradientId})`}
          />
        </Svg>
      )}
      {children}
    </View>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    ring: {
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
