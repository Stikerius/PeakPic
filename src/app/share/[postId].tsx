import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { ProfileRow } from "@/components/profile-row";
import { colors, fontSize, spacing } from "@/constants/theme";
import { shareCommentWithUser, sharePostWithUser } from "@/lib/chatRepo";
import { listFollowing } from "@/lib/socialRepo";
import type { PublicProfile } from "@/types/social";

type SendState = "sending" | "sent" | "error";

/** Sends a post, or with `commentId` one of its comments, into direct chats. */
export default function SharePostScreen() {
  const { postId, commentId } = useLocalSearchParams<{ postId: string; commentId?: string }>();
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});

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
      if (commentId !== undefined) await shareCommentWithUser({ id: commentId, postId }, userId);
      else await sharePostWithUser(postId, userId);
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
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
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
          <Ionicons name="paper-plane-outline" size={48} color={colors.textMuted} />
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
  );
}

const styles = StyleSheet.create({
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
  hint: {
    color: colors.textMuted,
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
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
    lineHeight: 22,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
