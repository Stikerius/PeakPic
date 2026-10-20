import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createEditedPhoto,
  overlayFonts,
  renderEditedPhoto,
  type CanvasSize,
  type EditedPhoto,
} from "@/components/media-editor/edited-photo";
import { MediaCanvas } from "@/components/media-editor/media-canvas";
import { TaggedTextInput } from "@/components/tagged-text-input";
import { MentionPicker } from "@/components/media-editor/mention-picker";
import type { MediaOverlay } from "@/components/media-editor/overlay";
import { sameEdits, toPhotoEdits, type PhotoEdits } from "@/lib/photoEdits";
import { TextOverlayEditor, type TextOverlayValue } from "@/components/media-editor/text-overlay-editor";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { filterTaggable } from "@/lib/inboxRepo";
import { MAX_TAGS } from "@/lib/workoutLinks";
import { STORY_FILTERS } from "@/lib/storyFilters";
import type { PublicProfile } from "@/types/social";

export const CAPTION_MAX_LENGTH = 200;
/** Exported post photos are this wide (4:5); stories use the screen's pixel width. */
const POST_EXPORT_WIDTH = 1080;
const STORY_EXPORT_MAX_WIDTH = 1080;
/** Space the post layout needs below and above the canvas (header, strip, caption, button). */
const POST_CHROME_HEIGHT = 340;

export type EditorPhoto = {
  /** The caller's reference for an existing photo (see InitialPhoto), null for new ones. */
  source: string | null;
  /** The unedited original (local file for new photos). */
  originalUri: string;
  /** JPEG with the edits burned in; null if the photo has no edits or is unchanged. */
  renderedUri: string | null;
  /** Edits to store with the photo, so it can be edited again from the original. */
  edits: PhotoEdits | null;
  /** New photo, or its edits differ from when the editor opened. */
  changed: boolean;
};

export type MediaEditorResult = {
  /** Photos in carousel order. */
  photos: EditorPhoto[];
  /** Everyone tagged: on the photos, plus earlier tags that weren't removed. */
  mentionIds: string[];
  /** Tagged people who should also get this workout for their streak (asked per person). */
  workoutLinkIds: string[];
  caption: string;
  /** "Im Profil anzeigen" (post variant with the switch shown). */
  showInProfile: boolean;
  /** Width / height of the canvas the edits are relative to. */
  canvasAspect: number;
};

/** A photo that already exists, opened for editing again. */
export type InitialPhoto = { uri: string; source: string; edits: PhotoEdits | null };

type MediaEditorProps = {
  /** "story": one full-screen photo. "post": 4:5 photos with carousel, caption and tags. */
  variant: "story" | "post";
  /** New photos (local files). */
  initialUris?: string[];
  /** Existing photos with their stored edits (editing a post again). */
  initialPhotos?: InitialPhoto[];
  /** People tagged before; shown as removable tags even without a mention on a photo. */
  initialTags?: PublicProfile[];
  initialCaption?: string;
  /** Post variant: shows the "Im Profil anzeigen" switch with this starting value. */
  initialShowInProfile?: boolean;
  /** Story variant: extra controls above the filters (e.g. "add to highlight"). */
  storyExtras?: ReactNode;
  /** Post variant: how many photos may be in the carousel (1 hides "add"). */
  maxPhotos?: number;
  showCaption?: boolean;
  title?: string;
  submitLabel: string;
  onBack: () => void;
  /** Uploads the result. Returns an error message, or null when done. */
  onSubmit: (result: MediaEditorResult) => Promise<string | null>;
};

type TextEditing = { id: string | null; initial: TextOverlayValue };

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Filters, text, tags and (for posts) several photos; shared by stories and posts. */
export function MediaEditor({
  variant,
  initialUris = [],
  initialPhotos = [],
  initialTags = [],
  initialCaption = "",
  initialShowInProfile,
  storyExtras,
  maxPhotos = 1,
  showCaption = false,
  title,
  submitLabel,
  onBack,
  onSubmit,
}: MediaEditorProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [fonts] = useState(overlayFonts);
  const isStory = variant === "story";
  const postWidth = Math.min(width, (height - insets.top - insets.bottom - POST_CHROME_HEIGHT) / 1.25);
  const size: CanvasSize = isStory ? { width, height } : { width: postWidth, height: postWidth * 1.25 };
  const [photos, setPhotos] = useState<EditedPhoto[]>(() => [
    ...initialPhotos.map((p) => createEditedPhoto(p.uri, { source: p.source, edits: p.edits, size })),
    ...initialUris.map((uri) => createEditedPhoto(uri)),
  ]);
  // Earlier tags without a mention on any photo (e.g. posts edited before edits were stored).
  const [extraTags, setExtraTags] = useState<PublicProfile[]>(initialTags);
  const [workoutLinks, setWorkoutLinks] = useState<ReadonlySet<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [caption, setCaption] = useState(initialCaption);
  const [showInProfile, setShowInProfile] = useState(initialShowInProfile ?? true);
  const [textEditing, setTextEditing] = useState<TextEditing | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const photo = photos[Math.min(current, photos.length - 1)];
  const mentions = [
    ...new Map(
      [...photos.flatMap((p) => p.items.flatMap((item) => (item.kind === "mention" ? [item.user] : []))), ...extraTags].map(
        (user) => [user.id, user],
      ),
    ).values(),
  ];
  const mentionIds = mentions.map((m) => m.id);
  const center = { x: size.width / 2, y: size.height * (isStory ? 0.42 : 0.5) };

  function updatePhoto(next: EditedPhoto) {
    setPhotos((prev) => prev.map((p) => (p.key === next.key ? next : p)));
  }

  function updateItems(change: (items: MediaOverlay[]) => MediaOverlay[]) {
    if (photo !== undefined) updatePhoto({ ...photo, items: change(photo.items) });
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
      if (trimmed.length > 0) {
        updateItems((items) => [...items, { id: createId(), kind: "text", text: trimmed, color, background, ...center }]);
      }
      return;
    }
    updateItems((items) =>
      trimmed.length === 0
        ? items.filter((i) => i.id !== editing.id)
        : items.map((i) => (i.id === editing.id && i.kind === "text" ? { ...i, text: trimmed, color, background } : i)),
    );
  }

  function editItem(item: MediaOverlay) {
    if (item.kind !== "text") return;
    setTextEditing({ id: item.id, initial: { text: item.text, color: item.color, background: item.background } });
  }

  /** Untags someone: removes their mentions from all photos. */
  function removeTag(userId: string) {
    setPhotos((prev) =>
      prev.map((p) => ({ ...p, items: p.items.filter((i) => !(i.kind === "mention" && i.user.id === userId)) })),
    );
    setExtraTags((prev) => prev.filter((u) => u.id !== userId));
    setWorkoutLinks((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }

  async function addMention(user: PublicProfile) {
    setMentionPickerOpen(false);
    const alreadyTagged = mentionIds.includes(user.id);
    if (!alreadyTagged && mentionIds.length >= MAX_TAGS) {
      Alert.alert("Zu viele Markierungen", `Du kannst höchstens ${MAX_TAGS} Personen markieren.`);
      return;
    }
    try {
      // Same rule as the database: their setting, a connection, or public content.
      const allowed = await filterTaggable([user.id], isStory ? "stories" : "posts");
      if (!allowed.has(user.id)) {
        Alert.alert("Markieren nicht möglich", `@${user.username} lässt sich von dir nicht markieren.`);
        return;
      }
    } catch (error) {
      Alert.alert("Markieren fehlgeschlagen", describeError(error));
      return;
    }
    updateItems((items) => [
      ...items,
      { id: createId(), kind: "mention", user, x: center.x, y: center.y + 60 * (items.length % 4) },
    ]);
    if (!isStory && !alreadyTagged) {
      Alert.alert("Auch fürs Workout verlinken?", `@${user.username} kann das Workout dann für den eigenen Streak annehmen.`, [
        { text: "Nein", style: "cancel" },
        { text: "Ja", onPress: () => setWorkoutLinks((prev) => new Set(prev).add(user.id)) },
      ]);
    }
  }

  async function addPhotos() {
    const room = maxPhotos - photos.length;
    if (room <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: room > 1,
      selectionLimit: room,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const added = result.assets.slice(0, room).map((asset) => createEditedPhoto(asset.uri));
    setPhotos((prev) => [...prev, ...added]);
    setCurrent(photos.length);
  }

  function moveCurrent(delta: -1 | 1) {
    const target = current + delta;
    if (target < 0 || target >= photos.length) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(current, 1);
      if (moved !== undefined) next.splice(target, 0, moved);
      return next;
    });
    setCurrent(target);
  }

  function removeCurrent() {
    if (photos.length <= 1) return;
    setPhotos((prev) => prev.filter((_, index) => index !== current));
    setCurrent(Math.max(0, current - 1));
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const outputWidth = isStory
        ? Math.min(STORY_EXPORT_MAX_WIDTH, Math.round(width * PixelRatio.get()))
        : POST_EXPORT_WIDTH;
      const result: EditorPhoto[] = [];
      for (const p of photos) {
        const edits = toPhotoEdits(p.filterIndex, p.items, size);
        const changed = p.source === null || !sameEdits(edits, p.initialEdits);
        // Stories are always rendered (cropped to the screen); post photos only when edited
        // and changed, unchanged ones keep their stored rendering.
        const render = isStory || (edits !== null && changed);
        result.push({
          source: p.source,
          originalUri: p.uri,
          renderedUri: render ? await renderEditedPhoto(p, size, fonts, outputWidth) : null,
          edits,
          changed,
        });
      }
      const error = await onSubmit({
        photos: result,
        mentionIds,
        workoutLinkIds: mentionIds.filter((id) => workoutLinks.has(id)),
        caption: caption.trim(),
        showInProfile,
        canvasAspect: size.width / size.height,
      });
      if (error !== null) Alert.alert("Hochladen fehlgeschlagen", error);
    } catch (error) {
      Alert.alert("Bild konnte nicht erstellt werden", describeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  const canvas =
    photo === undefined ? null : (
      <MediaCanvas
        key={photo.key}
        photo={photo}
        size={size}
        fonts={fonts}
        editingId={textEditing?.id ?? null}
        interactive={textEditing === null}
        onChange={updatePhoto}
        onTapPhoto={openNewText}
        onEditItem={editItem}
        onDraggingChange={setDragging}
      />
    );

  const tools = (
    <View style={styles.tools}>
      <Pressable onPress={openNewText} accessibilityRole="button" accessibilityLabel="Text hinzufügen" style={styles.roundButton}>
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
  );

  const filterChips = photo !== undefined && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {STORY_FILTERS.map((f, index) => (
        <Pressable
          key={f.id}
          onPress={() => updatePhoto({ ...photo, filterIndex: index })}
          accessibilityRole="button"
          accessibilityLabel={`Filter ${f.name}`}
          accessibilityState={{ selected: index === photo.filterIndex }}
          style={[styles.filterChip, index === photo.filterIndex && styles.filterChipActive]}
        >
          <Text style={[styles.filterLabel, index === photo.filterIndex && styles.filterLabelActive]}>{f.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const submitButton = (
    <Pressable
      onPress={() => void submit()}
      disabled={submitting || photos.length === 0}
      accessibilityRole="button"
      accessibilityLabel={submitLabel}
      style={({ pressed }) => [styles.submitButton, isStory && styles.submitStory, (pressed || submitting) && styles.pressed]}
    >
      {submitting ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          <Text style={styles.submitLabel}>{submitLabel}</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.text} />
        </>
      )}
    </Pressable>
  );

  const overlays = (
    <>
      {textEditing !== null && <TextOverlayEditor initial={textEditing.initial} onDone={finishText} />}
      <MentionPicker
        visible={mentionPickerOpen}
        excludeIds={photo?.items.flatMap((i) => (i.kind === "mention" ? [i.user.id] : [])) ?? []}
        onSelect={(user) => void addMention(user)}
        onClose={() => setMentionPickerOpen(false)}
      />
    </>
  );

  if (isStory) {
    const showChrome = !dragging && textEditing === null;
    return (
      <View style={styles.screen}>
        {canvas}
        {showChrome && (
          <View style={[styles.storyTop, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              onPress={onBack}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Zurück zur Kamera"
              style={styles.roundButton}
            >
              <Ionicons name="chevron-back" size={26} color={colors.text} />
            </Pressable>
            {tools}
          </View>
        )}
        {showChrome && (
          <View style={[styles.storyBottom, { paddingBottom: insets.bottom + spacing.md }]}>
            {storyExtras}
            {filterChips}
            {submitButton}
          </View>
        )}
        {overlays}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.postHeader, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          onPress={onBack}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Abbrechen"
          hitSlop={spacing.sm}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.postTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "position" : undefined}>
        <View style={[styles.canvasFrame, { width: size.width }]}>
          {canvas}
          {textEditing === null && !dragging && <View style={styles.canvasTools}>{tools}</View>}
          {photos.length > 1 && (
            <View style={styles.pageBadge} pointerEvents="none">
              <Text style={styles.pageBadgeText}>
                {current + 1}/{photos.length}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.postControls}>
          {filterChips}

          {maxPhotos > 1 && (
            <View style={styles.stripRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {photos.map((p, index) => (
                  <Pressable
                    key={p.key}
                    onPress={() => setCurrent(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Bild ${index + 1} bearbeiten`}
                    accessibilityState={{ selected: index === current }}
                    style={[styles.thumb, index === current && styles.thumbActive]}
                  >
                    <Image source={{ uri: p.uri }} style={styles.thumbImage} contentFit="cover" />
                  </Pressable>
                ))}
                {photos.length < maxPhotos && (
                  <Pressable
                    onPress={() => void addPhotos()}
                    accessibilityRole="button"
                    accessibilityLabel="Weitere Bilder hinzufügen"
                    style={[styles.thumb, styles.addThumb]}
                  >
                    <Ionicons name="add" size={26} color={colors.text} />
                  </Pressable>
                )}
              </ScrollView>
              {photos.length > 1 && (
                <View style={styles.orderButtons}>
                  <Pressable
                    onPress={() => moveCurrent(-1)}
                    disabled={current === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Bild nach vorne"
                    hitSlop={spacing.xs}
                  >
                    <Ionicons name="chevron-back" size={22} color={current === 0 ? colors.border : colors.text} />
                  </Pressable>
                  <Pressable
                    onPress={() => moveCurrent(1)}
                    disabled={current === photos.length - 1}
                    accessibilityRole="button"
                    accessibilityLabel="Bild nach hinten"
                    hitSlop={spacing.xs}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={22}
                      color={current === photos.length - 1 ? colors.border : colors.text}
                    />
                  </Pressable>
                  <Pressable
                    onPress={removeCurrent}
                    accessibilityRole="button"
                    accessibilityLabel="Bild entfernen"
                    hitSlop={spacing.xs}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {mentions.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
              <Text style={styles.tagged}>Markiert:</Text>
              {mentions.map((user) => (
                <Pressable
                  key={user.id}
                  onPress={() => removeTag(user.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Markierung @${user.username} entfernen`}
                  style={styles.tagChip}
                >
                  {workoutLinks.has(user.id) && (
                    <Ionicons name="link" size={14} color={colors.primary} accessibilityLabel="fürs Workout verlinkt" />
                  )}
                  <Text style={styles.tagChipText}>@{user.username}</Text>
                  <Ionicons name="close" size={14} color={colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          )}

          {showCaption && (
            <TaggedTextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Beschriftung hinzufügen… (@ und # möglich)"
              placeholderTextColor={colors.textMuted}
              maxLength={CAPTION_MAX_LENGTH}
              style={styles.caption}
              editable={!submitting}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              accessibilityLabel="Beschriftung"
            />
          )}

          {initialShowInProfile !== undefined && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Im Profil anzeigen</Text>
              <Switch
                value={showInProfile}
                onValueChange={setShowInProfile}
                trackColor={{ true: colors.primary, false: colors.border }}
                accessibilityLabel="Im Profil anzeigen"
              />
            </View>
          )}

          <View style={{ paddingBottom: insets.bottom + spacing.sm }}>{submitButton}</View>
        </View>
      </KeyboardAvoidingView>
      {overlays}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  flex: {
    flex: 1,
  },
  storyTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  storyBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.md,
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
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
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
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  submitStory: {
    alignSelf: "flex-end",
  },
  submitLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  postTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 28,
  },
  canvasFrame: {
    alignSelf: "center",
  },
  canvasTools: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
  },
  pageBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  pageBadgeText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  postControls: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    backgroundColor: "#000000",
  },
  stripRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: spacing.md,
  },
  strip: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  thumb: {
    width: 48,
    height: 60,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbActive: {
    borderColor: colors.primary,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  addThumb: {
    alignItems: "center",
    justifyContent: "center",
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  orderButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  tagRow: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  tagged: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
  },
  tagChipText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  switchLabel: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  caption: {
    minHeight: 44,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
  },
});
