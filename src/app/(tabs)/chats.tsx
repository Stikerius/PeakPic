import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import { showActionSheet } from "@/lib/actionSheet";
import { resetChatBackground } from "@/lib/chatBackground";
import {
  clearChatForMe,
  listConversations,
  subscribeToConversationDeletes,
  subscribeToMessageDeletes,
  subscribeToMessages,
} from "@/lib/chatRepo";
import { emitAppEvent } from "@/lib/events";
import { formatRelativeTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";
import type { ConversationSummary } from "@/types/chat";
import { track, useTrackScreen } from "@/lib/usage";

export default function ChatListScreen() {
  useTrackScreen("screen_chats");
  const { colors } = useTheme();
  const styles = useStyles();
  const myId = useSession().session?.user.id;
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ids of the last message per chat: when one of them is deleted for everyone, reload.
  const lastMessageIds = useRef(new Set<string>());

  async function load() {
    try {
      const list = await listConversations();
      lastMessageIds.current = new Set(list.flatMap((c) => (c.lastMessage !== null ? [c.lastMessage.id] : [])));
      setConversations(list);
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
  useEffect(
    () =>
      subscribeToMessageDeletes((messageId) => {
        if (lastMessageIds.current.has(messageId)) void load();
      }),
    [],
  );

  // A chat ended for everybody (data reset): gone from the list at once, with its unread count.
  useEffect(
    () =>
      subscribeToConversationDeletes((conversationId) => {
        setConversations((current) => current?.filter((c) => c.id !== conversationId) ?? current);
      }),
    [],
  );

  /** Long press on a chat: "Chat löschen" only for me; the other person notices nothing. */
  function showChatActions(conversation: ConversationSummary) {
    showActionSheet(conversation.partner.displayName, [
      {
        label: "Chat löschen",
        destructive: true,
        onPress: () =>
          Alert.alert(
            "Chat löschen?",
            "Der Verlauf wird nur bei dir gelöscht. Schreibt jemand wieder, erscheint der Chat ohne die alten Nachrichten.",
            [
              { text: "Abbrechen", style: "cancel" },
              { text: "Löschen", style: "destructive", onPress: () => void clearChat(conversation.id) },
            ],
          ),
      },
    ]);
  }

  async function clearChat(conversationId: string) {
    try {
      await clearChatForMe(conversationId);
    } catch (clearError) {
      Alert.alert("Chat nicht gelöscht", clearError instanceof Error ? clearError.message : "Bitte versuche es erneut.");
      return;
    }
    track("chat_cleared_for_me");
    setConversations((current) => current?.filter((c) => c.id !== conversationId) ?? current);
    if (myId !== undefined) resetChatBackground(myId, conversationId);
    emitAppEvent("chatRead", undefined);
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <>
      {conversations === null ? (
        <View style={styles.centered}>
          {error !== null ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      ) : (
        <FlatList
          style={styles.screen}
          data={conversations}
          keyExtractor={(c) => c.id}
          contentContainerStyle={conversations.length === 0 ? styles.emptyContainer : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />
          }
          renderItem={({ item }) => {
            const unread = item.unreadCount > 0;
            return (
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/chats/[conversationId]", params: { conversationId: item.id } })
                }
                onLongPress={() => showChatActions(item)}
                accessibilityRole="button"
                accessibilityHint="Lange drücken für weitere Aktionen"
                accessibilityLabel={`Chat mit ${item.partner.username || item.partner.displayName}${unread ? `, ${item.unreadCount} ungelesen` : ""}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Avatar uri={item.partner.avatarUrl} username={item.partner.username} size={52} />
                <View style={styles.rowText}>
                  <Text style={[styles.username, unread && styles.bold]} numberOfLines={1}>
                    {item.partner.displayName}
                    {item.partner.username !== "" && <Text style={styles.handle}> @{item.partner.username}</Text>}
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
              <Ionicons name="chatbubbles-outline" size={56} color={colors.textSecondary} />
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

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
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
    handle: {
      ...typography.caption,
      fontWeight: "400",
      color: colors.textSecondary,
    },
    bold: {
      fontWeight: "800",
    },
    preview: {
      color: colors.textSecondary,
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
      color: colors.textSecondary,
      fontSize: 12,
    },
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    badgeText: {
      color: colors.onAccent,
      fontSize: 12,
      fontWeight: "700",
    },
    emptyTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
    emptyBody: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);
