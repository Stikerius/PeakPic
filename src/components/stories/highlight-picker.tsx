import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { fontSize, radius, spacing } from "@/constants/theme";
import {
  HIGHLIGHT_TITLE_MAX_LENGTH,
  listMyHighlights,
  type Highlight,
  type HighlightChoice,
} from "@/lib/highlightRepo";
import { makeStyles, useTheme } from "@/lib/theme";

type HighlightPickerProps = {
  visible: boolean;
  onPick: (choice: HighlightChoice) => void;
  onClose: () => void;
};

/** Pick one of my highlights, or name a new one (the story becomes its cover). */
export function HighlightPicker({ visible, onPick, onClose }: HighlightPickerProps) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [newTitle, setNewTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNewTitle(null);
    listMyHighlights()
      .then(setHighlights)
      .catch(() => setFailed(true));
  }, [visible]);

  const title = newTitle?.trim() ?? "";

  return (
    <Sheet visible={visible} title="Zu Highlight hinzufügen" onClose={onClose}>
      {newTitle !== null ? (
        <View style={styles.form}>
          <TextInput
            keyboardAppearance={scheme}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Name des Highlights"
            placeholderTextColor={colors.textSecondary}
            maxLength={HIGHLIGHT_TITLE_MAX_LENGTH}
            autoFocus
            style={styles.input}
            accessibilityLabel="Name des Highlights"
          />
          <Text style={styles.hint}>Die Story wird das Titelbild. Du kannst es im Profil ändern.</Text>
          <Button
            label="Highlight erstellen"
            disabled={title.length === 0}
            onPress={() => onPick({ kind: "new", title })}
          />
        </View>
      ) : highlights === null && !failed ? (
        <ActivityIndicator style={styles.loader} color={colors.accent} />
      ) : (
        <FlatList
          data={highlights ?? []}
          keyExtractor={(h) => h.id}
          ListHeaderComponent={
            <Pressable
              onPress={() => setNewTitle("")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.cover, styles.newCover]}>
                <Ionicons name="add" size={26} color={colors.text} />
              </View>
              <Text style={styles.rowTitle}>Neues Highlight</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick({ kind: "existing", id: item.id, title: item.title })}
              accessibilityRole="button"
              accessibilityLabel={`Zu ${item.title} hinzufügen`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {item.coverUrl !== null ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} contentFit="cover" />
              ) : (
                <View style={styles.cover} />
              )}
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.hint}>
                  {item.storyIds.length} {item.storyIds.length === 1 ? "Story" : "Storys"}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            failed ? <Text style={[styles.hint, styles.padded]}>Highlights konnten nicht geladen werden.</Text> : null
          }
        />
      )}
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    loader: {
      marginTop: spacing.xl,
    },
    form: {
      gap: spacing.md,
      padding: spacing.md,
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
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pressed: {
      backgroundColor: colors.surface,
    },
    cover: {
      width: 52,
      height: 52,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceRaised,
    },
    newCover: {
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    padded: {
      padding: spacing.md,
    },
  }),
);
