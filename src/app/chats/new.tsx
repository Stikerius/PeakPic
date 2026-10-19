import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ProfileRow } from "@/components/profile-row";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { getOrCreateDirectConversation } from "@/lib/chatRepo";
import { describeError } from "@/lib/errors";
import { listFollowing } from "@/lib/socialRepo";
import type { PublicProfile } from "@/types/social";

/** Start a chat with someone you follow (or open the existing one). */
export default function NewChatScreen() {
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [query, setQuery] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listFollowing()
      .then(setPeople)
      .catch(() => setError("Konnte nicht laden, wem du folgst."));
  }, []);

  async function open(person: PublicProfile) {
    if (openingId !== null) return;
    setOpeningId(person.id);
    setError(null);
    try {
      const conversationId = await getOrCreateDirectConversation(person.id);
      router.dismiss();
      router.push({ pathname: "/chats/[conversationId]", params: { conversationId } });
    } catch (openError) {
      setError(`Chat konnte nicht geöffnet werden – ${describeError(openError)}`);
      setOpeningId(null);
    }
  }

  const term = query.trim().toLowerCase();
  const visiblePeople = (people ?? []).filter((p) => p.username.includes(term));

  return (
    <View style={styles.screen}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Suchen"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
        accessibilityLabel="Personen suchen"
      />
      {error !== null && <Text style={styles.error}>{error}</Text>}
      {people === null && error === null ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <FlatList
          data={visiblePeople}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void open(item)}
              disabled={openingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Chat mit ${item.username}`}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <ProfileRow
                profile={item}
                accessory={openingId === item.id ? <ActivityIndicator color={colors.primary} /> : null}
              />
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {(people ?? []).length === 0
                ? "Du kannst mit Leuten chatten, denen du folgst. Du folgst noch niemandem."
                : "Niemand gefunden."}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
    padding: spacing.xl,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
  },
});
