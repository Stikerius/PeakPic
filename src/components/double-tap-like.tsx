import * as Haptics from "expo-haptics";
import { useCallback, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { BURST_HEART_SIZE, createBurst, LikeBurst, type Burst } from "@/components/like-burst";
import { clampBurstCenter, type DoubleTapResult } from "@/lib/doubleTapLike";
import { track } from "@/lib/usage";

/** At most this many hearts at once; older ones make room. */
const MAX_BURSTS = 3;

type DoubleTapLikeProps = {
  /** What the screen shows (optimistic included). A taken-back like hides the hearts at once. */
  liked: boolean;
  /** Likes the post (never unlikes) and tells whether that was a new like. */
  onDoubleTap: () => DoubleTapResult;
  /** A single tap that does something else (e.g. open the photo). Without it nothing waits. */
  onSingleTap?: () => void;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
};

/**
 * Put around a post photo: double tap likes it with a heart burst where the finger was. Scrolling,
 * swiping the carousel and swipe-to-dismiss keep working (a tap fails as soon as the finger moves).
 */
export function DoubleTapLike({ liked, onDoubleTap, onSingleTap, style, onLayout, children }: DoubleTapLikeProps) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const removeBurst = useCallback((id: number) => setBursts((previous) => previous.filter((b) => b.id !== id)), []);

  function showBurst(x: number, y: number) {
    const center = clampBurstCenter(x, y, size.width, size.height, BURST_HEART_SIZE);
    const burst = createBurst(center.x, center.y);
    setBursts((previous) => [...previous, burst].slice(-MAX_BURSTS));
  }

  function handleDoubleTap(x: number, y: number) {
    const result = onDoubleTap();
    if (result === "liked") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      track("post_like_double_tap");
    }
    showBurst(x, y);
  }

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .runOnJS(true)
    .onEnd((event, success) => {
      if (success) handleDoubleTap(event.x, event.y);
    });
  const gesture =
    onSingleTap !== undefined
      ? Gesture.Exclusive(
          doubleTap,
          Gesture.Tap()
            .runOnJS(true)
            .onEnd((_event, success) => {
              if (success) onSingleTap();
            }),
        )
      : doubleTap;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={style}
        collapsable={false}
        onLayout={(event) => {
          setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
          onLayout?.(event);
        }}
      >
        {children}
        {/* A like the server refused hides its hearts right away. */}
        <LikeBurst bursts={bursts} hidden={!liked} onDone={removeBurst} />
      </View>
    </GestureDetector>
  );
}
