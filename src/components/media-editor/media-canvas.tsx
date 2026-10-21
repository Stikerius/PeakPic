import Ionicons from "@expo/vector-icons/Ionicons";
import { Canvas, ColorMatrix, Image as SkiaImage, useImage } from "@shopify/react-native-skia";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { filterOf, type CanvasSize, type EditedPhoto } from "@/components/media-editor/edited-photo";
import {
  OverlayDrawing,
  OverlayHandle,
  type MediaOverlay,
  type OverlayFonts,
} from "@/components/media-editor/overlay";
import { onPhoto, radius, spacing } from "@/constants/theme";
import { STORY_FILTERS } from "@/lib/storyFilters";
import { makeStyles, useTheme } from "@/lib/theme";

/** Height of the drop zone at the bottom of the canvas that deletes a dragged overlay. */
const TRASH_ZONE = 120;
const FILTER_SWIPE_DISTANCE = 60;
const FILTER_TOAST_MS = 900;

type MediaCanvasProps = {
  photo: EditedPhoto;
  size: CanvasSize;
  fonts: OverlayFonts;
  /** Overlay currently open in the text editor; it is hidden on the canvas meanwhile. */
  editingId: string | null;
  /** Hides overlay handles, e.g. while the text editor is open. */
  interactive: boolean;
  onChange: (photo: EditedPhoto) => void;
  /** Tap on the photo (outside overlays): start a new text. */
  onTapPhoto: () => void;
  onEditItem: (item: MediaOverlay) => void;
  onDraggingChange: (dragging: boolean) => void;
};

/**
 * One photo with its filter and overlays, drawn with Skia. Swipe sideways to change the
 * filter, tap to add text, drag overlays to move them or onto the trash to remove them.
 */
export function MediaCanvas({
  photo,
  size,
  fonts,
  editingId,
  interactive,
  onChange,
  onTapPhoto,
  onEditItem,
  onDraggingChange,
}: MediaCanvasProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const image = useImage(photo.uri);
  const containerRef = useRef<View>(null);
  const [pageY, setPageY] = useState(0);
  const [filterToast, setFilterToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);

  const filter = filterOf(photo);
  const trashY = pageY + size.height - TRASH_ZONE;

  useEffect(() => {
    if (filterToast === null) return;
    const timer = setTimeout(() => setFilterToast(null), FILTER_TOAST_MS);
    return () => clearTimeout(timer);
  }, [filterToast]);

  function selectFilter(index: number) {
    const next = (index + STORY_FILTERS.length) % STORY_FILTERS.length;
    onChange({ ...photo, filterIndex: next });
    setFilterToast(STORY_FILTERS[next]?.name ?? null);
  }

  function setDraggingState(value: boolean) {
    setDragging(value);
    onDraggingChange(value);
  }

  function moveItem(id: string, x: number, y: number, fingerY: number) {
    onChange({ ...photo, items: photo.items.map((i) => (i.id === id ? { ...i, x, y } : i)) });
    setOverTrash(fingerY > trashY);
  }

  function endDrag(id: string, fingerY: number) {
    if (fingerY > trashY) onChange({ ...photo, items: photo.items.filter((i) => i.id !== id) });
    setDraggingState(false);
    setOverTrash(false);
  }

  const swipeFilter = Gesture.Pan()
    .activeOffsetX([-25, 25])
    .failOffsetY([-25, 25])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationX < -FILTER_SWIPE_DISTANCE) selectFilter(photo.filterIndex + 1);
      else if (event.translationX > FILTER_SWIPE_DISTANCE) selectFilter(photo.filterIndex - 1);
    });
  const tapToType = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_event, success) => {
      if (success) onTapPhoto();
    });

  return (
    <View
      ref={containerRef}
      style={[styles.container, size]}
      onLayout={() => containerRef.current?.measureInWindow((_x, y) => setPageY(y))}
    >
      <GestureDetector gesture={Gesture.Race(swipeFilter, tapToType)}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill}>
            {image !== null && (
              <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit="cover">
                {filter !== undefined && <ColorMatrix matrix={[...filter.matrix]} />}
              </SkiaImage>
            )}
            {photo.items
              .filter((item) => item.id !== editingId)
              .map((item) => (
                <OverlayDrawing key={item.id} item={item} fonts={fonts} />
              ))}
          </Canvas>
        </View>
      </GestureDetector>

      {image === null && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.text} />
        </View>
      )}

      {interactive &&
        photo.items.map((item) => (
          <OverlayHandle
            key={item.id}
            item={item}
            fonts={fonts}
            onMove={moveItem}
            onDragStart={() => setDraggingState(true)}
            onDragEnd={endDrag}
            onTap={onEditItem}
          />
        ))}

      {filterToast !== null && (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.toastText}>{filterToast}</Text>
        </View>
      )}

      {dragging && (
        <View style={styles.trash} pointerEvents="none">
          <View style={[styles.trashCircle, overTrash && styles.trashCircleActive]}>
            <Ionicons name="trash" size={overTrash ? 30 : 24} color={colors.text} />
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      overflow: "hidden",
      backgroundColor: onPhoto.background,
    },
    center: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    toastText: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "800",
      textShadowColor: onPhoto.textShadow,
      textShadowRadius: 8,
    },
    trash: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: spacing.lg,
      alignItems: "center",
    },
    trashCircle: {
      width: 56,
      height: 56,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: onPhoto.scrimStrong,
      borderWidth: 2,
      borderColor: colors.text,
    },
    trashCircleActive: {
      width: 72,
      height: 72,
      backgroundColor: colors.danger,
    },
  }),
);
