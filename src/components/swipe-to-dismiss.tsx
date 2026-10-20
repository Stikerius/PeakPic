import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";

type SwipeToDismissProps = {
  onDismiss: () => void;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Wraps content that should close when dragged down. For screens that combine the drag
 * with other gestures (taps, horizontal swipes), use useSwipeToDismiss directly.
 */
export function SwipeToDismiss({ onDismiss, enabled, style, children }: SwipeToDismissProps) {
  const { gesture, animatedStyle } = useSwipeToDismiss({ onDismiss, enabled });
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.flex, style, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
