import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/avatar";
import { MessageBubble } from "@/components/chat/message-bubble";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  fetchMessages,
  getConversationPartner,
  markConversationRead,
  sendTextMessage,
  subscribeToMessages,
} from "@/lib/chatRepo";
import { emitAppEvent } from "@/lib/events";
import { useSession } from "@/lib/session";
import type { ChatMessage } from "@/types/chat";
import type { PublicProfile } from "@/types/social";

function markRead(conversationId: string) {
  markConversationRead(conversationId)
    .then(() => emitAppEvent("chatRead", undefined))
    .catch((error: unknown) => console.warn("[chat] Lesestatus nicht gespeichert:", error));
}

/** Adds messages that aren't known yet, newest first. */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const known = new Set(current.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return current;
  return [...fresh, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const myId = useSession().session?.user.id;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [partner, setPartner] = useState<PublicProfile | null>(null);
  // Newest first, for the inverted list.
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getConversationPartner(conversationId)
      .then((result) => {
        if (active) setPartner(result);
      })
      .catch(() => undefined);
    fetchMessages(conversationId, null)
      .then((page) => {
        if (!active) return;
        setMessages((current) => mergeMessages(current ?? [], page));
        setHasMore(page.length === MESSAGE_PAGE_SIZE);
      })
      .catch(() => {
        if (active) setError("Nachrichten konnten nicht geladen werden.");
      });
    markRead(conversationId);

    const unsubscribe = subscribeToMessages((message) => {
      setMessages((current) => mergeMessages(current ?? [], [message]));
      if (message.senderId !== myId) markRead(conversationId);
    }, conversationId);

    return () => {
      active = false;
      unsubscribe();
      markRead(conversationId);
    };
  }, [conversationId, myId]);

  async function loadOlder() {
    const oldest = messages?.[messages.length - 1];
    if (!hasMore || loadingOlder || oldest === undefined) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, oldest.createdAt);
      setMessages((current) => mergeMessages(current ?? [], page));
      setHasMore(page.length === MESSAGE_PAGE_SIZE);
    } catch {
      setError("Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send() {
    const body = draft.trim();
    if (body.length === 0 || myId === undefined) return;
    const temp: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId,
      senderId: myId,
      body,
      post: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setDraft("");
    setError(null);
    setMessages((current) => [temp, ...(current ?? [])]);
    try {
      const sent = await sendTextMessage(conversationId, body);
      // Realtime may have delivered the real message already; drop the placeholder either way.
      setMessages((current) => mergeMessages((current ?? []).filter((m) => m.id !== temp.id), [sent]));
    } catch {
      setMessages((current) => (current ?? []).filter((m) => m.id !== temp.id));
      setDraft(body);
      setError("Nachricht konnte nicht gesendet werden.");
    }
  }

  const canSend = draft.trim().length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () =>
            partner !== null ? (
              <Pressable
                onPress={() => router.push({ pathname: "/user/[userId]", params: { userId: partner.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Profil von ${partner.username}`}
                style={styles.headerTitle}
              >
                <Avatar uri={partner.avatarUrl} username={partner.username} size={30} />
                <Text style={styles.headerName}>{partner.username}</Text>
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={headerHeight}
      >
        {messages === null ? (
          <View style={styles.centered}>
            {error !== null ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
        ) : (
          <FlatList
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <MessageBubble message={item} mine={item.senderId === myId} />}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.primary} /> : null}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {partner !== null ? `Schreib @${partner.username} die erste Nachricht.` : ""}
                </Text>
              </View>
            }
          />
        )}

        {messages !== null && error !== null && <Text style={styles.inlineError}>{error}</Text>}

        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Nachricht…"
            placeholderTextColor={colors.textMuted}
            maxLength={MESSAGE_MAX_LENGTH}
            multiline
            style={styles.input}
            accessibilityLabel="Nachricht"
          />
          <Pressable
            onPress={() => void send()}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Senden"
            style={[styles.sendButton, !canSend && styles.sendDisabled]}
          >
            <Ionicons name="arrow-up" size={20} color={colors.text} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    padding: spacing.lg,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // The list is inverted, so flip the empty state back.
    transform: [{ scaleY: -1 }],
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  inlineError: {
    color: colors.danger,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    fontSize: fontSize.md,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    opacity: 0.4,
  },
});
