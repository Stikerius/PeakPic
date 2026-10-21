import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { ProfileRow } from "@/components/profile-row";
import { fontSize, radius, spacing } from "@/constants/theme";
import { MESSAGE_MAX_LENGTH, shareCommentWithUser, sharePostWithUser } from "@/lib/chatRepo";
import { listFollowing } from "@/lib/socialRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { PublicProfile } from "@/types/social";

type SendState = "sending" | "sent" | "error";

/** Sends a post, or with `commentId` one of its comments, into direct chats. */
export default function SharePostScreen() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { postId, commentId } = useLocalSearchParams<{ postId: string; commentId?: string }>();
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  // Optional message sent along with the card, to everyone it is sent to from here.
  const [note, setNote] = useState("");

  useEffect(() => {
    let active = true;
    listFollowing()
      .then((result) => {
        if (active) setPeople(result);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function send(userId: string) {
    setSendStates((prev) => ({ ...prev, [userId]: "sending" }));
    try {
      if (commentId !== undefined) await shareCommentWithUser({ id: commentId, postId }, userId, note);
      else await sharePostWithUser(postId, userId, note);
      setSendStates((prev) => ({ ...prev, [userId]: "sent" }));
    } catch {
      setSendStates((prev) => ({ ...prev, [userId]: "error" }));
    }
  }

  if (people === null) {
    return (
      <View style={styles.centered}>
        {loadError ? (
          <Text style={styles.error}>Kontakte konnten nicht geladen werden.</Text>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {people.length > 0 && (
        <TextInput
          keyboardAppearance={scheme}
          value={note}
          onChangeText={setNote}
          placeholder="Nachricht hinzufügen (optional)"
          placeholderTextColor={colors.textSecondary}
          maxLength={MESSAGE_MAX_LENGTH}
          multiline
          style={styles.note}
          accessibilityLabel="Nachricht, die mitgesendet wird"
        />
      )}
      <FlatList
        style={styles.screen}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={people}
        keyExtractor={(person) => person.id}
        contentContainerStyle={people.length === 0 ? styles.emptyContainer : styles.list}
        ListHeaderComponent={
          people.length > 0 ? (
            <Text style={styles.hint}>
              {commentId !== undefined
                ? "Der Kommentar wird mit einem Link zum Post im Chat mit der Person geteilt."
                : "Der Post wird im Chat mit der Person geteilt."}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const state = sendStates[item.id];
          return (
            <ProfileRow
              profile={item}
              accessory={
                state === "sent" ? (
                  <View style={styles.sent} accessibilityLabel="Gesendet">
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={styles.sentText}>Gesendet</Text>
                  </View>
                ) : (
                  <Button
                    label={state === "error" ? "Nochmal" : "Senden"}
                    size="sm"
                    onPress={() => void send(item.id)}
                    loading={state === "sending"}
                  />
                )
              }
            />
          );
        }}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="paper-plane-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>
              Du kannst Posts an Leute senden, denen du folgst. Du folgst noch niemandem.
            </Text>
            <Button
              label="Leute finden"
              onPress={() => {
                router.back();
                router.push("/search");
              }}
            />
          </View>
        }
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    list: {
      paddingVertical: spacing.sm,
    },
    emptyContainer: {
      flexGrow: 1,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    note: {
      minHeight: 44,
      maxHeight: 120,
      margin: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: 12,
      paddingBottom: 12,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.md,
    },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    sent: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    sentText: {
      color: colors.success,
      fontSize: fontSize.sm,
      fontWeight: "600",
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
      lineHeight: 22,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);
