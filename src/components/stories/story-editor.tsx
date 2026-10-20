import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MediaEditor } from "@/components/media-editor/media-editor";
import { HighlightPicker } from "@/components/stories/highlight-picker";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import type { HighlightChoice } from "@/lib/highlightRepo";
import { addStory } from "@/lib/storyStore";

type StoryEditorProps = {
  photoUri: string;
  onBack: () => void;
  onShared: () => void;
};

/** Story flow's editor: the shared media editor in its full-screen story layout. */
export function StoryEditor({ photoUri, onBack, onShared }: StoryEditorProps) {
  const [highlight, setHighlight] = useState<HighlightChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const highlightButton = (
    <View style={styles.extras}>
      <Pressable
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={highlight !== null ? `Highlight ${highlight.title} ändern` : "Zu Highlight hinzufügen"}
        style={styles.chip}
      >
        <Ionicons name={highlight !== null ? "bookmark" : "bookmark-outline"} size={16} color={colors.text} />
        <Text style={styles.chipLabel}>{highlight !== null ? highlight.title : "Zu Highlight hinzufügen"}</Text>
      </Pressable>
      {highlight !== null && (
        <Pressable
          onPress={() => setHighlight(null)}
          accessibilityRole="button"
          accessibilityLabel="Highlight entfernen"
          hitSlop={spacing.sm}
          style={styles.chip}
        >
          <Ionicons name="close" size={16} color={colors.text} />
        </Pressable>
      )}
    </View>
  );

  return (
    <>
      <MediaEditor
        variant="story"
        initialUris={[photoUri]}
        submitLabel="Deine Story"
        storyExtras={highlightButton}
        onBack={onBack}
        onSubmit={async ({ photos, mentionIds }) => {
          const [photo] = photos;
          if (photo === undefined) return "Kein Bild.";
          const error = await addStory(photo.renderedUri ?? photo.originalUri, mentionIds, highlight);
          if (error === null) onShared();
          return error;
        }}
      />
      <HighlightPicker
        visible={pickerOpen}
        onPick={(choice) => {
          setHighlight(choice);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  extras: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  chipLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
});
