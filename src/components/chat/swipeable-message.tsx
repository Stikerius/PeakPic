import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { radius } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

/** Drag distance (px) that triggers the action, and how far the message follows the finger. */
const TRIGGER = 60;
const MAX_DRAG = 90;
const ICON_SIZE = 32;

type SwipeableMessageProps = {
  /** My own message (right-aligned): the swipe directions are mirrored. */
  mine: boolean;
  pinned: boolean;
  /** Swipe towards the middle of the screen. */
  onReply: () => void;
  /** Swipe towards the screen edge. */
  onTogglePin: () => void;
  /** Long press; `pageY` is where the finger is, for placing the reaction bar. */
  onLongPress: (pageY: number) => void;
  children: ReactNode;
};

/**
 * A chat message that follows the finger sideways: towards the middle of the screen to
 * reply, towards the edge to pin or unpin. Others' messages: right = reply, left = pin;
 * my own messages are mirrored. Vertical movement fails the pan quickly so the list
 * keeps scrolling normally.
 */
export function SwipeableMessage({ mine, pinned, onReply, onTogglePin, onLongPress, children }: SwipeableMessageProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      const x = event.translationX;
      translateX.value = Math.sign(x) * Math.min(Math.abs(x), MAX_DRAG);
    })
    .onEnd(() => {
      const onRight = mine ? onTogglePin : onReply;
      const onLeft = mine ? onReply : onTogglePin;
      if (translateX.value >= TRIGGER) scheduleOnRN(onRight);
      else if (translateX.value <= -TRIGGER) scheduleOnRN(onLeft);
      translateX.value = withSpring(0);
    });

  const longPress = Gesture.LongPress()
    .minDuration(350)
    .runOnJS(true)
    .onStart((event) => onLongPress(event.absoluteY));

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  // The left icon shows while dragging right, the right icon while dragging left.
  const leftIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [10, TRIGGER], [0, 1], "clamp"),
    transform: [{ scale: interpolate(translateX.value, [10, TRIGGER], [0.6, 1], "clamp") }],
  }));
  const rightIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateX.value, [10, TRIGGER], [0, 1], "clamp"),
    transform: [{ scale: interpolate(-translateX.value, [10, TRIGGER], [0.6, 1], "clamp") }],
  }));

  const replyIcon = <Ionicons name="arrow-undo" size={18} color={colors.text} />;
  const pinIcon = <Ionicons name={pinned ? "pin-outline" : "pin"} size={18} color={colors.text} />;

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress)}>
      <View collapsable={false}>
        <Animated.View style={[styles.icon, styles.iconLeft, leftIconStyle]} pointerEvents="none">
          {mine ? pinIcon : replyIcon}
        </Animated.View>
        <Animated.View style={[styles.icon, styles.iconRight, rightIconStyle]} pointerEvents="none">
          {mine ? replyIcon : pinIcon}
        </Animated.View>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    icon: {
      position: "absolute",
      top: "50%",
      marginTop: -ICON_SIZE / 2,
      width: ICON_SIZE,
      height: ICON_SIZE,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceRaised,
    },
    iconLeft: {
      left: 0,
    },
    iconRight: {
      right: 0,
    },
  }),
);
