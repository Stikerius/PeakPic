import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  ImageFormat,
  matchFont,
  useCanvasRef,
  useImage,
} from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MentionPicker } from "@/components/stories/mention-picker";
import {
  OverlayDrawing,
  OverlayHandle,
  type OverlayFonts,
  type StoryOverlay,
} from "@/components/stories/story-overlay";
import { TextOverlayEditor, type TextOverlayValue } from "@/components/stories/text-overlay-editor";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { STORY_FILTERS } from "@/lib/storyFilters";
import { addStory } from "@/lib/storyStore";
import type { PublicProfile } from "@/types/social";

/** Drop zone height at the bottom of the screen for deleting overlays. */
const TRASH_ZONE = 140;
const FILTER_SWIPE_DISTANCE = 60;
const FILTER_TOAST_MS = 900;
const EXPORT_JPEG_QUALITY = 92;

const FONT_FAMILY = Platform.select({ ios: "Helvetica Neue", default: "sans-serif" });

type TextEditing = { id: string | null; initial: TextOverlayValue };

type StoryEditorProps = {
  photoUri: string;
  onBack: () => void;
  onShared: () => void;
};

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function StoryEditor({ photoUri, onBack, onShared }: StoryEditorProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const canvasRef = useCanvasRef();
  const image = useImage(photoUri);
  const fonts: OverlayFonts = {
    text: matchFont({ fontFamily: FONT_FAMILY, fontSize: 30, fontWeight: "bold" }),
    mention: matchFont({ fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: "bold" }),
  };

  const [filterIndex, setFilterIndex] = useState(0);
  const [filterToast, setFilterToast] = useState<string | null>(null);
  const [items, setItems] = useState<StoryOverlay[]>([]);
  const [textEditing, setTextEditing] = useState<TextEditing | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [sharing, setSharing] = useState(false);

  const filter = STORY_FILTERS[filterIndex] ?? STORY_FILTERS[0];
  const mentionIds = items.flatMap((item) => (item.kind === "mention" ? [item.user.id] : []));
  const center = { x: width / 2, y: height * 0.42 };

  useEffect(() => {
    if (filterToast === null) return;
    const timer = setTimeout(() => setFilterToast(null), FILTER_TOAST_MS);
    return () => clearTimeout(timer);
  }, [filterToast]);

  function selectFilter(index: number) {
    const next = (index + STORY_FILTERS.length) % STORY_FILTERS.length;
    setFilterIndex(next);
    setFilterToast(STORY_FILTERS[next]?.name ?? null);
  }

  function openNewText() {
    setTextEditing({ id: null, initial: { text: "", color: "#FFFFFF", background: false } });
  }

  function finishText({ text, color, background }: TextOverlayValue) {
    const editing = textEditing;
    setTextEditing(null);
    if (editing === null) return;
    const trimmed = text.trim();
    if (editing.id === null) {
      if (trimmed.length === 0) return;
      setItems((prev) => [...prev, { id: createId(), kind: "text", text: trimmed, color, background, ...center }]);
      return;
    }
    setItems((prev) =>
      trimmed.length === 0
        ? prev.filter((i) => i.id !== editing.id)
        : prev.map((i) => (i.id === editing.id && i.kind === "text" ? { ...i, text: trimmed, color, background } : i)),
    );
  }

  function addMention(user: PublicProfile) {
    setMentionPickerOpen(false);
    setItems((prev) => [
      ...prev,
      { id: createId(), kind: "mention", user, x: center.x, y: center.y + 60 * (prev.length % 4) },
    ]);
  }

  function moveItem(id: string, x: number, y: number, fingerY: number) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, x, y } : i)));
    setOverTrash(fingerY > height - TRASH_ZONE);
  }

  function endDrag(id: string, fingerY: number) {
    if (fingerY > height - TRASH_ZONE) setItems((prev) => prev.filter((i) => i.id !== id));
    setDraggingId(null);
    setOverTrash(false);
  }

  function editItem(item: StoryOverlay) {
    if (item.kind !== "text") return;
    setTextEditing({ id: item.id, initial: { text: item.text, color: item.color, background: item.background } });
  }

  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      const snapshot = await canvasRef.current?.makeImageSnapshotAsync();
      if (snapshot === undefined) throw new Error("Bild konnte nicht erzeugt werden.");
      const file = new File(Paths.cache, `story-${Date.now()}.jpg`);
      file.create({ overwrite: true });
      file.write(snapshot.encodeToBytes(ImageFormat.JPEG, EXPORT_JPEG_QUALITY));
      const error = await addStory(file.uri, mentionIds);
      if (error !== null) {
        Alert.alert("Upload fehlgeschlagen", error);
        return;
      }
      onShared();
    } catch (error) {
      Alert.alert("Story konnte nicht erstellt werden", describeError(error));
    } finally {
      setSharing(false);
    }
  }

  // Swipe left/right on the photo to change the filter, tap to add text.
  const swipeFilter = Gesture.Pan()
    .activeOffsetX([-25, 25])
    .failOffsetY([-25, 25])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationX < -FILTER_SWIPE_DISTANCE) selectFilter(filterIndex + 1);
      else if (event.translationX > FILTER_SWIPE_DISTANCE) selectFilter(filterIndex - 1);
    });
  const tapToType = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_event, success) => {
      if (success) openNewText();
    });

  const editingId = textEditing?.id ?? null;
  const showChrome = draggingId === null && textEditing === null;

  return (
    <View style={styles.screen}>
      <GestureDetector gesture={Gesture.Race(swipeFilter, tapToType)}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
            {image !== null && (
              <SkiaImage image={image} x={0} y={0} width={width} height={height} fit="cover">
                <ColorMatrix matrix={[...filter.matrix]} />
              </SkiaImage>
            )}
            {items
              .filter((item) => item.id !== editingId)
              .map((item) => (
                <OverlayDrawing key={item.id} item={item} fonts={fonts} />
              ))}
          </Canvas>
        </View>
      </GestureDetector>

      {image === null && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.text} />
        </View>
      )}

      {textEditing === null &&
        items.map((item) => (
          <OverlayHandle
            key={item.id}
            item={item}
            fonts={fonts}
            onMove={moveItem}
            onDragStart={setDraggingId}
            onDragEnd={endDrag}
            onTap={editItem}
          />
        ))}

      {filterToast !== null && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{filterToast}</Text>
        </View>
      )}

      {showChrome && (
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable
            onPress={onBack}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="Zurück zur Kamera"
            style={styles.roundButton}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <View style={styles.tools}>
            <Pressable
              onPress={openNewText}
              accessibilityRole="button"
              accessibilityLabel="Text hinzufügen"
              style={styles.roundButton}
            >
              <Text style={styles.toolLabel}>Aa</Text>
            </Pressable>
            <Pressable
              onPress={() => setMentionPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Person markieren"
              style={styles.roundButton}
            >
              <Ionicons name="at" size={24} color={colors.text} />
            </Pressable>
          </View>
        </View>
      )}

      {showChrome && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {STORY_FILTERS.map((f, index) => (
              <Pressable
                key={f.id}
                onPress={() => selectFilter(index)}
                accessibilityRole="button"
                accessibilityLabel={`Filter ${f.name}`}
                accessibilityState={{ selected: index === filterIndex }}
                style={[styles.filterChip, index === filterIndex && styles.filterChipActive]}
              >
                <Text style={[styles.filterLabel, index === filterIndex && styles.filterLabelActive]}>
                  {f.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => void share()}
            disabled={sharing || image === null}
            accessibilityRole="button"
            accessibilityLabel="Story teilen"
            style={({ pressed }) => [styles.shareButton, (pressed || sharing) && styles.pressed]}
          >
            {sharing ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Text style={styles.shareLabel}>Deine Story</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.text} />
              </>
            )}
          </Pressable>
        </View>
      )}

      {draggingId !== null && (
        <View style={[styles.trash, { bottom: insets.bottom + spacing.xl }]} pointerEvents="none">
          <View style={[styles.trashCircle, overTrash && styles.trashCircleActive]}>
            <Ionicons name="trash" size={overTrash ? 30 : 24} color={colors.text} />
          </View>
        </View>
      )}

      {textEditing !== null && (
        <TextOverlayEditor initial={textEditing.initial} onDone={finishText} />
      )}

      <MentionPicker
        visible={mentionPickerOpen}
        excludeIds={mentionIds}
        onSelect={addMention}
        onClose={() => setMentionPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  loading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  tools: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  toolLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "800",
  },
  toast: {
    position: "absolute",
    top: "40%",
    alignSelf: "center",
  },
  toastText: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    textShadowColor: "rgba(0, 0, 0, 0.6)",
    textShadowRadius: 8,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.md,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  filterChipActive: {
    backgroundColor: colors.text,
  },
  filterLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  filterLabelActive: {
    color: colors.background,
  },
  shareButton: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  shareLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
  trash: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  trashCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    borderWidth: 2,
    borderColor: colors.text,
  },
  trashCircleActive: {
    width: 72,
    height: 72,
    backgroundColor: colors.danger,
  },
});
