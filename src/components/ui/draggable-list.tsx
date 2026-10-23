import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { radius, spacing } from "@/constants/theme";
import { dropIndex, type RowRect } from "@/lib/sortable";
import { makeStyles, useTheme } from "@/lib/theme";

type DraggableListProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The row at `from` was dropped at `to`. */
  onMove: (from: number, to: number) => void;
  /** While a row is being dragged (e.g. to stop the surrounding ScrollView from scrolling). */
  onDragChange?: (dragging: boolean) => void;
  /** The row; put `handle` where the drag handle should be. */
  renderItem: (item: T, index: number, handle: ReactElement) => ReactElement;
};

/**
 * A short list that can be reordered by dragging: press the handle a moment, drag, let go. A
 * line shows where the row will land. The handle is hidden from VoiceOver; the rows offer arrow
 * buttons for that. No auto-scrolling: rows move within the visible part of the screen.
 */
export function DraggableList<T>({ items, keyOf, onMove, onDragChange, renderItem }: DraggableListProps<T>) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [rects, setRects] = useState<Record<string, RowRect>>({});
  const [dragging, setDragging] = useState<{ index: number; target: number } | null>(null);
  const translateY = useSharedValue(0);
  const draggedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const ordered = items.map((item) => rects[keyOf(item)] ?? { y: 0, height: 0 });

  function handleFor(index: number): ReactElement {
    const pan = Gesture.Pan()
      .activateAfterLongPress(200)
      .runOnJS(true)
      .onStart(() => {
        translateY.value = 0;
        setDragging({ index, target: index });
        onDragChange?.(true);
      })
      .onUpdate((event) => {
        translateY.value = event.translationY;
        const target = dropIndex(ordered, index, event.translationY);
        setDragging((current) => (current !== null && current.target !== target ? { index, target } : current));
      })
      .onEnd((event) => {
        const target = dropIndex(ordered, index, event.translationY);
        if (target !== index) onMove(index, target);
      })
      .onFinalize(() => {
        translateY.value = 0;
        setDragging(null);
        onDragChange?.(false);
      });
    return (
      <GestureDetector gesture={pan}>
        <View
          style={styles.handle}
          collapsable={false}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="reorder-three-outline" size={22} color={colors.textSecondary} />
        </View>
      </GestureDetector>
    );
  }

  // Where the line goes: above the row the dragged one will take the place of.
  const lineBefore =
    dragging === null || dragging.target === dragging.index
      ? null
      : dragging.target > dragging.index
        ? dragging.target + 1
        : dragging.target;

  return (
    <View>
      {items.map((item, index) => {
        const key = keyOf(item);
        const isDragged = dragging?.index === index;
        return (
          <View
            key={key}
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              setRects((current) =>
                current[key]?.y === y && current[key]?.height === height ? current : { ...current, [key]: { y, height } },
              );
            }}
            style={isDragged ? styles.raised : undefined}
          >
            {lineBefore === index && <View style={[styles.line, styles.lineTop]} pointerEvents="none" />}
            <Animated.View style={isDragged ? [styles.dragged, draggedStyle] : undefined}>
              {renderItem(item, index, handleFor(index))}
            </Animated.View>
            {lineBefore === items.length && index === items.length - 1 && (
              <View style={[styles.line, styles.lineBottom]} pointerEvents="none" />
            )}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    handle: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    raised: {
      zIndex: 10,
    },
    dragged: {
      opacity: 0.92,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    line: {
      position: "absolute",
      left: spacing.md,
      right: spacing.md,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.text,
    },
    lineTop: {
      top: -1,
    },
    lineBottom: {
      bottom: -1,
    },
  }),
);
