import { useWindowDimensions, type ViewStyle } from "react-native";
import { Gesture, type PanGesture } from "react-native-gesture-handler";
import {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/** Drag distance (px) or downward velocity (px/s) that dismisses. */
export const DISMISS_DISTANCE = 120;
export const DISMISS_VELOCITY = 1000;

type SwipeToDismissOptions = {
  /** Called on the JS thread once the content has slid out. */
  onDismiss: () => void;
  enabled?: boolean;
  /** Opacity the content fades to while dragged down. */
  fadeTo?: number;
  /** JS callbacks while the content is being dragged (e.g. to pause a timer). */
  onDragStart?: () => void;
  /** Called when the content springs back instead of being dismissed. */
  onDragCancel?: () => void;
};

type SwipeToDismiss = {
  /** Pan that only reacts to downward drags; compose it with other gestures as needed. */
  gesture: PanGesture;
  /** Apply to the Animated.View that should follow the finger. */
  animatedStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  translateY: SharedValue<number>;
};

/**
 * Drag down to dismiss: the content follows the finger, and is dismissed when dragged far
 * or fast enough, otherwise it springs back. Used by every full-screen view and sheet.
 */
export function useSwipeToDismiss({
  onDismiss,
  enabled = true,
  fadeTo = 0.5,
  onDragStart,
  onDragCancel,
}: SwipeToDismissOptions): SwipeToDismiss {
  const { height } = useWindowDimensions();
  const translateY = useSharedValue(0);

  const gesture = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetY(10)
    .failOffsetX([-20, 20])
    .onStart(() => {
      if (onDragStart !== undefined) scheduleOnRN(onDragStart);
    })
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        translateY.value = withTiming(height, { duration: 180 }, () => scheduleOnRN(onDismiss));
      } else {
        translateY.value = withSpring(0);
        if (onDragCancel !== undefined) scheduleOnRN(onDragCancel);
      }
    });

  const animatedStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(translateY.value, [0, height * 0.5], [1, fadeTo], "clamp"),
  }));

  return { gesture, animatedStyle, translateY };
}
