import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

type ZoomableImageProps = {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
};

/** Pinch or double-tap to zoom; while zoomed, one finger moves the photo around. */
function ZoomableImage({ uri, width, height, onZoomChange }: ZoomableImageProps) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  function reportZoom(value: boolean) {
    setZoomed(value);
    onZoomChange(value);
  }

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), MAX_ZOOM);
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withTiming(1);
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        savedScale.value = 1;
        scheduleOnRN(reportZoom, false);
      } else {
        savedScale.value = scale.value;
        scheduleOnRN(reportZoom, true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .maxPointers(1)
    .onUpdate((event) => {
      // Keep the photo covering the screen: limit panning to the zoomed overflow.
      const maxX = ((scale.value - 1) * width) / 2;
      const maxY = ((scale.value - 1) * height) / 2;
      x.value = Math.min(Math.max(savedX.value + event.translationX, -maxX), maxX);
      y.value = Math.min(Math.max(savedY.value + event.translationY, -maxY), maxY);
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomIn = scale.value === 1;
      const target = zoomIn ? DOUBLE_TAP_ZOOM : 1;
      scale.value = withTiming(target);
      savedScale.value = target;
      x.value = withTiming(0);
      y.value = withTiming(0);
      savedX.value = 0;
      savedY.value = 0;
      scheduleOnRN(reportZoom, zoomIn);
    });

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View style={{ width, height }} collapsable={false}>
        <Animated.View style={[{ width, height }, imageStyle]}>
          <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

type PhotoViewerProps = {
  photoUrls: string[];
  /** Photo to open; null hides the viewer. */
  initialIndex: number | null;
  onClose: () => void;
};

/** Full-screen photos: swipe sideways between them, zoom, swipe down to close. */
export function PhotoViewer({ photoUrls, initialIndex, onClose }: PhotoViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const dismiss = useSwipeToDismiss({ onDismiss: onClose, enabled: !zoomed, fadeTo: 0.2 });
  // Two fingers mean pinch, never dismiss.
  dismiss.gesture.maxPointers(1);

  const visible = initialIndex !== null;
  const currentPage = initialIndex === null ? 0 : page;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        setPage(initialIndex ?? 0);
        setZoomed(false);
        dismiss.translateY.value = 0;
      }}
    >
      {/* Modals render outside the app's gesture root. */}
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden />
        <GestureDetector gesture={dismiss.gesture}>
          <Animated.View style={[styles.root, dismiss.animatedStyle]}>
            {visible && (
              <FlatList
                data={photoUrls}
                keyExtractor={(url, index) => `${index}-${url}`}
                horizontal
                pagingEnabled
                scrollEnabled={!zoomed && photoUrls.length > 1}
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={initialIndex}
                getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
                onMomentumScrollEnd={(event) => setPage(Math.round(event.nativeEvent.contentOffset.x / width))}
                renderItem={({ item }) => (
                  <ZoomableImage uri={item} width={width} height={height} onZoomChange={setZoomed} />
                )}
              />
            )}
          </Animated.View>
        </GestureDetector>
        <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
          {photoUrls.length > 1 ? (
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {currentPage + 1}/{photoUrls.length}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Foto schliessen"
            hitSlop={spacing.sm}
            style={styles.close}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  top: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  counter: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  counterText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});
