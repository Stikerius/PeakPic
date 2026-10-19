import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { listConversations, subscribeToMessages } from "@/lib/chatRepo";
import { formatRelativeTime } from "@/lib/format";
import type { ConversationSummary } from "@/types/chat";

function NewChatButton() {
  return (
    <Link href="/chats/new" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel="Neuer Chat" hitSlop={spacing.sm}>
        <Ionicons name="create-outline" size={24} color={colors.text} />
      </Pressable>
    </Link>
  );
}

export default function ChatListScreen() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setConversations(await listConversations());
      setError(null);
    } catch {
      setError("Chats konnten nicht geladen werden.");
    }
  }

  useFocusEffect(
    useCallback(() => {
      void load();
    }, []),
  );

  // New messages in any of my chats bump the list.
  useEffect(() => subscribeToMessages(() => void load()), []);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <>
      <Stack.Screen options={{ headerRight: NewChatButton }} />
      {conversations === null ? (
        <View style={styles.centered}>
          {error !== null ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <FlatList
          style={styles.screen}
          data={conversations}
          keyExtractor={(c) => c.id}
          contentContainerStyle={conversations.length === 0 ? styles.emptyContainer : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />
          }
          renderItem={({ item }) => {
            const unread = item.unreadCount > 0;
            return (
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/chats/[conversationId]", params: { conversationId: item.id } })
                }
                accessibilityRole="button"
                accessibilityLabel={`Chat mit ${item.partner.username}${unread ? `, ${item.unreadCount} ungelesen` : ""}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Avatar uri={item.partner.avatarUrl} username={item.partner.username} size={52} />
                <View style={styles.rowText}>
                  <Text style={[styles.username, unread && styles.bold]} numberOfLines={1}>
                    {item.partner.username}
                  </Text>
                  <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                    {item.lastMessage === null
                      ? "Sag hallo 👋"
                      : `${item.lastMessage.fromMe ? "Du: " : ""}${item.lastMessage.text}`}
                  </Text>
                </View>
                <View style={styles.meta}>
                  {item.lastMessage !== null && (
                    <Text style={styles.time}>{formatRelativeTime(item.lastMessage.createdAt)}</Text>
                  )}
                  {unread && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="chatbubbles-outline" size={56} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Noch keine Chats</Text>
              <Text style={styles.emptyBody}>Schreib Leuten, denen du folgst, oder teile einen Post.</Text>
              <Button label="Neuer Chat" onPress={() => router.push("/chats/new")} />
            </View>
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  emptyContainer: {
    flexGrow: 1,
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
  rowText: {
    flex: 1,
    gap: 2,
  },
  username: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  bold: {
    fontWeight: "800",
  },
  preview: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  previewUnread: {
    color: colors.text,
    fontWeight: "600",
  },
  meta: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  time: {
    color: colors.textMuted,
    fontSize: 12,
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  badgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
