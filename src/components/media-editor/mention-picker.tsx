import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ProfileRow } from "@/components/profile-row";
import { fontSize, radius, spacing } from "@/constants/theme";
import { listConnections } from "@/lib/socialRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { PublicProfile } from "@/types/social";

type MentionPickerProps = {
  visible: boolean;
  excludeIds: string[];
  onSelect: (profile: PublicProfile) => void;
  onClose: () => void;
};

/** Sheet to pick someone to tag: people I follow or who follow me (the database decides the rest). */
export function MentionPicker({ visible, excludeIds, onSelect, onClose }: MentionPickerProps) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || people !== null) return;
    listConnections()
      .then(setPeople)
      .catch(() => setFailed(true));
  }, [visible, people]);

  const term = query.trim().toLowerCase();
  const visiblePeople = (people ?? []).filter(
    (p) => !excludeIds.includes(p.id) && p.username.includes(term),
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Person markieren</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schliessen" hitSlop={spacing.sm}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
        <TextInput
          keyboardAppearance={scheme}
          value={query}
          onChangeText={setQuery}
          placeholder="Suchen"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
          accessibilityLabel="Personen suchen"
        />
        {people === null && !failed ? (
          <ActivityIndicator style={styles.loader} color={colors.accent} />
        ) : (
          <FlatList
            data={visiblePeople}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`@${item.username} markieren`}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <ProfileRow profile={item} />
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {failed
                  ? "Konnte nicht laden, wem du folgst."
                  : (people ?? []).length === 0
                    ? "Du kannst nur Leute markieren, denen du folgst."
                    : "Niemand gefunden."}
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: spacing.md,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
    },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
    search: {
      margin: spacing.md,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: fontSize.md,
    },
    loader: {
      marginTop: spacing.xl,
    },
    pressed: {
      opacity: 0.6,
    },
    empty: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
      padding: spacing.xl,
    },
  }),
);
