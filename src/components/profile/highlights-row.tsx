import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { STORY_RING_INSET, StoryRing } from "@/components/stories/story-ring";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import type { Highlight } from "@/lib/highlightRepo";

const COVER_SIZE = 60;
const ITEM_SIZE = COVER_SIZE + 2 * STORY_RING_INSET;

type HighlightsRowProps = {
  highlights: Highlight[];
  /** Own profile: long press (or the edit hint) opens the highlight editor. */
  editable: boolean;
};

/** Highlight circles below the profile header; tap opens them in the story viewer. */
export function HighlightsRow({ highlights, editable }: HighlightsRowProps) {
  if (highlights.length === 0) return null;

  function open(highlight: Highlight) {
    router.push({
      pathname: "/stories/[userId]",
      params: { userId: highlight.userId, highlightId: highlight.id },
    });
  }

  function edit(highlight: Highlight) {
    router.push({ pathname: "/highlight/[highlightId]", params: { highlightId: highlight.id } });
  }

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {highlights.map((highlight) => (
          <Pressable
            key={highlight.id}
            onPress={() => open(highlight)}
            onLongPress={editable ? () => edit(highlight) : undefined}
            accessibilityRole="button"
            accessibilityLabel={`Highlight ${highlight.title}`}
            accessibilityHint={editable ? "Lange drücken zum Bearbeiten" : undefined}
            style={styles.item}
          >
            <StoryRing size={ITEM_SIZE} state="seen">
              {highlight.coverUrl !== null ? (
                <Image source={{ uri: highlight.coverUrl }} style={styles.cover} contentFit="cover" />
              ) : (
                <View style={[styles.cover, styles.coverMissing]}>
                  <Ionicons name="bookmark" size={22} color={colors.textMuted} />
                </View>
              )}
            </StoryRing>
            <Text style={styles.title} numberOfLines={1}>
              {highlight.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {editable && <Text style={styles.hint}>Lange drücken, um ein Highlight zu bearbeiten</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  item: {
    width: ITEM_SIZE,
    alignItems: "center",
    gap: spacing.xs,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
  },
  coverMissing: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    width: ITEM_SIZE + spacing.sm,
    color: colors.text,
    fontSize: fontSize.sm - 1,
    textAlign: "center",
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    paddingHorizontal: spacing.md,
  },
});
