import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { colors, radius } from "@/constants/theme";

/** Drag distance (px) that triggers the action, and how far the message follows the finger. */
const TRIGGER = 60;
const MAX_DRAG = 90;
const ICON_SIZE = 32;

type SwipeableMessageProps = {
  pinned: boolean;
  /** Swipe right. */
  onReply: () => void;
  /** Swipe left. */
  onTogglePin: () => void;
  /** Long press; `pageY` is where the finger is, for placing the reaction bar. */
  onLongPress: (pageY: number) => void;
  children: ReactNode;
};

/**
 * A chat message that follows the finger sideways: right to reply, left to pin or unpin.
 * Vertical movement fails the pan quickly so the list keeps scrolling normally.
 */
export function SwipeableMessage({ pinned, onReply, onTogglePin, onLongPress, children }: SwipeableMessageProps) {
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      const x = event.translationX;
      translateX.value = Math.sign(x) * Math.min(Math.abs(x), MAX_DRAG);
    })
    .onEnd(() => {
      if (translateX.value >= TRIGGER) scheduleOnRN(onReply);
      else if (translateX.value <= -TRIGGER) scheduleOnRN(onTogglePin);
      translateX.value = withSpring(0);
    });

  const longPress = Gesture.LongPress()
    .minDuration(350)
    .runOnJS(true)
    .onStart((event) => onLongPress(event.absoluteY));

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [10, TRIGGER], [0, 1], "clamp"),
    transform: [{ scale: interpolate(translateX.value, [10, TRIGGER], [0.6, 1], "clamp") }],
  }));
  const pinIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateX.value, [10, TRIGGER], [0, 1], "clamp"),
    transform: [{ scale: interpolate(-translateX.value, [10, TRIGGER], [0.6, 1], "clamp") }],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress)}>
      <View collapsable={false}>
        <Animated.View style={[styles.icon, styles.iconLeft, replyIconStyle]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={18} color={colors.text} />
        </Animated.View>
        <Animated.View style={[styles.icon, styles.iconRight, pinIconStyle]} pointerEvents="none">
          <Ionicons name={pinned ? "pin-outline" : "pin"} size={18} color={colors.text} />
        </Animated.View>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  icon: {
    position: "absolute",
    top: "50%",
    marginTop: -ICON_SIZE / 2,
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  iconLeft: {
    left: 0,
  },
  iconRight: {
    right: 0,
  },
});
