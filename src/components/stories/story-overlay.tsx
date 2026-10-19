import { Group, RoundedRect, Text as SkiaText, type SkFont } from "@shopify/react-native-skia";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { colors } from "@/constants/theme";
import type { PublicProfile } from "@/types/social";

export type StoryOverlay =
  | { id: string; kind: "text"; text: string; color: string; background: boolean; x: number; y: number }
  | { id: string; kind: "mention"; user: PublicProfile; x: number; y: number };

export type OverlayFonts = { text: SkFont; mention: SkFont };

const PADDING_X = 14;
const PADDING_Y = 8;

/** Black or white, whichever reads better on `hex`. */
export function contrastColor(hex: string): string {
  const value = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#000000" : "#FFFFFF";
}

type OverlayLayout = {
  label: string;
  font: SkFont;
  textColor: string;
  background: string | null;
  /** Bounding box including padding, in canvas coordinates. */
  box: { x: number; y: number; width: number; height: number };
  baseline: { x: number; y: number };
};

/** Where and how an overlay is drawn; shared by the Skia drawing and its touch handle. */
export function layoutOverlay(item: StoryOverlay, fonts: OverlayFonts): OverlayLayout {
  const isText = item.kind === "text";
  const label = isText ? item.text : `@${item.user.username}`;
  const font = isText ? fonts.text : fonts.mention;
  const metrics = font.measureText(label);
  const width = metrics.width + 2 * PADDING_X;
  const height = metrics.height + 2 * PADDING_Y;
  const background = isText ? (item.background ? item.color : null) : "#FFFFFF";
  const textColor = isText
    ? item.background
      ? contrastColor(item.color)
      : item.color
    : colors.primary;
  return {
    label,
    font,
    textColor,
    background,
    box: { x: item.x - width / 2, y: item.y - height / 2, width, height },
    // measureText's y is the (negative) distance from the baseline to the top of the glyphs.
    baseline: { x: item.x - metrics.width / 2, y: item.y - (metrics.y + metrics.height / 2) },
  };
}

/** Skia drawing of one overlay. Rendered inside the editor's Canvas, so it ends up in the export. */
export function OverlayDrawing({ item, fonts }: { item: StoryOverlay; fonts: OverlayFonts }) {
  const layout = layoutOverlay(item, fonts);
  return (
    <Group>
      {layout.background !== null && (
        <RoundedRect
          x={layout.box.x}
          y={layout.box.y}
          width={layout.box.width}
          height={layout.box.height}
          r={10}
          color={layout.background}
        />
      )}
      {layout.background === null && (
        // Soft shadow so text without background stays readable on bright photos.
        <SkiaText
          x={layout.baseline.x + 1.5}
          y={layout.baseline.y + 1.5}
          text={layout.label}
          font={layout.font}
          color="rgba(0, 0, 0, 0.45)"
        />
      )}
      <SkiaText
        x={layout.baseline.x}
        y={layout.baseline.y}
        text={layout.label}
        font={layout.font}
        color={layout.textColor}
      />
    </Group>
  );
}

type OverlayHandleProps = {
  item: StoryOverlay;
  fonts: OverlayFonts;
  onMove: (id: string, x: number, y: number, fingerY: number) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, fingerY: number) => void;
  onTap: (item: StoryOverlay) => void;
};

/** Invisible touch area on top of an overlay: drag to move, tap to edit. */
export function OverlayHandle({ item, fonts, onMove, onDragStart, onDragEnd, onTap }: OverlayHandleProps) {
  const start = useRef({ x: item.x, y: item.y });
  const { box } = layoutOverlay(item, fonts);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onStart(() => {
      start.current = { x: item.x, y: item.y };
      onDragStart(item.id);
    })
    .onUpdate((event) =>
      onMove(item.id, start.current.x + event.translationX, start.current.y + event.translationY, event.absoluteY),
    )
    .onEnd((event) => onDragEnd(item.id, event.absoluteY));

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_event, success) => {
      if (success) onTap(item);
    });

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        collapsable={false}
        style={[styles.handle, { left: box.x, top: box.y, width: box.width, height: box.height }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={item.kind === "text" ? `Text: ${item.text}` : `Markierung @${item.user.username}`}
        accessibilityHint="Ziehen zum Verschieben, auf den Mülleimer ziehen zum Entfernen"
      />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  handle: {
    position: "absolute",
  },
});
