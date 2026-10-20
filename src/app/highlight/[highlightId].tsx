import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { Button } from "@/components/button";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import {
  HIGHLIGHT_TITLE_MAX_LENGTH,
  deleteHighlight,
  fetchHighlightGroup,
  listMyHighlights,
  removeStoryFromHighlight,
  updateHighlight,
  type Highlight,
} from "@/lib/highlightRepo";
import type { Story } from "@/types/social";

const COLUMNS = 3;
const GAP = spacing.sm;

/** Edit one of my highlights: name, cover, which stories it contains, or delete it. */
export default function HighlightEditScreen() {
  const { highlightId } = useLocalSearchParams<{ highlightId: string }>();
  const { width } = useWindowDimensions();
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [title, setTitle] = useState("");
  const [coverId, setCoverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listMyHighlights(), fetchHighlightGroup(highlightId)])
      .then(([mine, group]) => {
        const found = mine.find((h) => h.id === highlightId) ?? null;
        setHighlight(found);
        setTitle(found?.title ?? "");
        setCoverId(found?.coverStoryId ?? group?.stories[0]?.id ?? null);
        setStories(group?.stories ?? []);
      })
      .catch((loadError: unknown) => setError(describeError(loadError)));
  }, [highlightId]);

  const tile = (width - 2 * spacing.md - GAP * (COLUMNS - 1)) / COLUMNS;
  const trimmed = title.trim();

  async function save() {
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateHighlight(highlightId, { title: trimmed, coverStoryId: coverId });
      emitAppEvent("highlightsChanged", undefined);
      router.back();
    } catch (saveError) {
      setError(describeError(saveError));
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove(story: Story) {
    const isLast = stories.length === 1;
    Alert.alert(
      "Aus Highlight entfernen?",
      isLast
        ? "Es ist die letzte Story. Das Highlight wird danach gelöscht."
        : "Die Story bleibt erhalten, sie ist nur nicht mehr in diesem Highlight.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Entfernen",
          style: "destructive",
          onPress: () => {
            const removal = isLast ? deleteHighlight(highlightId) : removeStoryFromHighlight(highlightId, story.id);
            removal
              .then(() => {
                emitAppEvent("highlightsChanged", undefined);
                if (isLast) {
                  router.back();
                  return;
                }
                setStories((prev) => prev.filter((s) => s.id !== story.id));
                if (coverId === story.id) setCoverId(stories.find((s) => s.id !== story.id)?.id ?? null);
              })
              .catch((removeError: unknown) => setError(describeError(removeError)));
          },
        },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert("Highlight löschen?", "Die Storys bleiben erhalten, nur das Highlight verschwindet.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: () => {
          deleteHighlight(highlightId)
            .then(() => {
              emitAppEvent("highlightsChanged", undefined);
              router.back();
            })
            .catch((deleteError: unknown) => setError(describeError(deleteError)));
        },
      },
    ]);
  }

  if (highlight === null) {
    return (
      <View style={styles.centered}>
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Highlight bearbeiten" }} />

      <Text style={styles.label}>Name</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={HIGHLIGHT_TITLE_MAX_LENGTH}
        placeholder="Name des Highlights"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        accessibilityLabel="Name des Highlights"
      />

      <Text style={styles.label}>Titelbild und Storys</Text>
      <Text style={styles.hint}>Tippe auf eine Story, um sie als Titelbild zu wählen.</Text>
      <View style={styles.grid}>
        {stories.map((story) => {
          const isCover = story.id === coverId;
          return (
            <Pressable
              key={story.id}
              onPress={() => setCoverId(story.id)}
              accessibilityRole="button"
              accessibilityLabel={isCover ? "Titelbild" : "Als Titelbild wählen"}
              accessibilityState={{ selected: isCover }}
              style={[styles.tile, { width: tile, height: tile * 1.6 }, isCover && styles.tileCover]}
            >
              {story.photoUrl !== null ? (
                <Image source={{ uri: story.photoUrl }} style={styles.tileImage} contentFit="cover" />
              ) : (
                <View style={styles.tileImage} />
              )}
              {isCover && (
                <View style={styles.coverBadge}>
                  <Ionicons name="checkmark" size={14} color={colors.text} />
                </View>
              )}
              <Pressable
                onPress={() => confirmRemove(story)}
                accessibilityRole="button"
                accessibilityLabel="Aus Highlight entfernen"
                hitSlop={spacing.xs}
                style={styles.removeButton}
              >
                <Ionicons name="close" size={14} color={colors.text} />
              </Pressable>
            </Pressable>
          );
        })}
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Button label="Speichern" onPress={() => void save()} loading={saving} disabled={trimmed.length === 0} />
      <Button label="Highlight löschen" variant="secondary" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  label: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: -spacing.sm,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
  },
  tile: {
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileCover: {
    borderColor: colors.primary,
  },
  tileImage: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceElevated,
  },
  coverBadge: {
    position: "absolute",
    left: spacing.xs,
    top: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  removeButton: {
    position: "absolute",
    right: spacing.xs,
    top: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
});
