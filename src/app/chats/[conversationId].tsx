import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MessageBubble } from "@/components/chat/message-bubble";
import { ReactionPicker } from "@/components/chat/reaction-picker";
import { useReport } from "@/components/moderation/report-provider";
import { SwipeableMessage } from "@/components/chat/swipeable-message";
import { TaggedTextInput } from "@/components/tagged-text-input";
import { Avatar } from "@/components/ui/avatar";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import { useBlockUser } from "@/hooks/use-block-user";
import { showActionSheet } from "@/lib/actionSheet";
import { isChatBlocked } from "@/lib/blockRepo";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  fetchMessages,
  fetchPinnedMessages,
  getConversationPartner,
  markConversationRead,
  messagePreview,
  sendTextMessage,
  setMessagePinned,
  setReaction,
  subscribeToChatChanges,
  subscribeToMessages,
} from "@/lib/chatRepo";
import { emitAppEvent } from "@/lib/events";
import { getMyProfile } from "@/lib/profileRepo";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";
import type { ChatMessage } from "@/types/chat";
import type { PublicProfile } from "@/types/social";

/** How many older pages a jump to a quoted or pinned message may load. */
const MAX_JUMP_PAGES = 20;
const HIGHLIGHT_MS = 1500;

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

/** My reaction replaced by `emoji` (null removes it). */
function withReaction(message: ChatMessage, userId: string, emoji: string | null): ChatMessage {
  const others = message.reactions.filter((r) => r.userId !== userId);
  return { ...message, reactions: emoji === null ? others : [...others, { userId, emoji }] };
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const myId = useSession().session?.user.id;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  const { openReport } = useReport();
  const blockUser = useBlockUser();
  const [partner, setPartner] = useState<PublicProfile | null>(null);
  // A block between us: the chat stays readable, but nobody can write in it.
  const [blocked, setBlocked] = useState(false);
  const [blockCheck, setBlockCheck] = useState(0);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  // Newest first, for the inverted list.
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pinned, setPinned] = useState<ChatMessage[]>([]);
  const [pinnedIndex, setPinnedIndex] = useState(0);
  const [picker, setPicker] = useState<{ message: ChatMessage; y: number } | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const partnerName = partner?.username ?? "";
  // Hidden profile (blocked, suspended or deleted): no profile link, no handle.
  const partnerAvailable = partner !== null && partner.username !== "";

  useEffect(() => {
    let active = true;
    isChatBlocked(conversationId)
      .then((result) => {
        if (active) setBlocked(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [conversationId, blockCheck]);

  function showChatMenu() {
    if (partner === null || !partnerAvailable) return;
    showActionSheet(partner.displayName, [
      { label: "Profil melden", destructive: true, onPress: () => openReport({ targetType: "profile", targetId: partner.id }) },
      { label: "Blockieren", destructive: true, onPress: () => blockUser(partner, () => setBlockCheck((v) => v + 1)) },
    ]);
  }

  function updateMessage(id: string, change: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current?.map((m) => (m.id === id ? change(m) : m)) ?? current);
  }

  function reloadPinned() {
    fetchPinnedMessages(conversationId)
      .then((result) => {
        setPinned(result);
        setPinnedIndex(0);
      })
      .catch((loadError: unknown) => console.warn("[chat] Angeheftete Nachrichten nicht geladen:", loadError));
  }

  useEffect(() => {
    let active = true;
    getConversationPartner(conversationId)
      .then((result) => {
        if (active) setPartner(result);
      })
      .catch(() => undefined);
    getMyProfile()
      .then((profile) => {
        if (active) setMyUsername(profile.username);
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
    reloadPinned();
    markRead(conversationId);

    const unsubscribeMessages = subscribeToMessages((message) => {
      setMessages((current) => mergeMessages(current ?? [], [message]));
      if (message.senderId !== myId) markRead(conversationId);
    }, conversationId);

    const unsubscribeChanges = subscribeToChatChanges(conversationId, (change) => {
      if (change.kind === "pin") {
        updateMessage(change.messageId, (m) => ({ ...m, pinnedAt: change.pinnedAt }));
        reloadPinned();
      } else {
        updateMessage(change.messageId, (m) => withReaction(m, change.userId, change.emoji));
      }
    });

    return () => {
      active = false;
      unsubscribeMessages();
      unsubscribeChanges();
      markRead(conversationId);
    };
  }, [conversationId, myId]);

  // Scroll to a message once it is in the list (a jump may first load older pages).
  useEffect(() => {
    if (jumpTarget === null || messages === null) return;
    const index = messages.findIndex((m) => m.id === jumpTarget);
    if (index === -1) return;
    setJumpTarget(null);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }));
    setHighlightedId(messages[index]?.id ?? null);
    setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
  }, [jumpTarget, messages]);

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

  /** Jumps to a message, loading older pages until it is there. */
  async function jumpTo(messageId: string) {
    let list = messages ?? [];
    let more = hasMore;
    let pages = 0;
    try {
      while (!list.some((m) => m.id === messageId) && more && pages < MAX_JUMP_PAGES) {
        const oldest = list[list.length - 1];
        if (oldest === undefined) break;
        const page = await fetchMessages(conversationId, oldest.createdAt);
        list = mergeMessages(list, page);
        more = page.length === MESSAGE_PAGE_SIZE;
        pages += 1;
      }
    } catch {
      setError("Nachricht konnte nicht geladen werden.");
      return;
    }
    if (!list.some((m) => m.id === messageId)) {
      setError("Nachricht nicht gefunden.");
      return;
    }
    setMessages((current) => mergeMessages(current ?? [], list));
    setHasMore(more);
    setJumpTarget(messageId);
  }

  function openPinned() {
    const target = pinned[pinnedIndex % pinned.length];
    if (target === undefined) return;
    void jumpTo(target.id);
    // With several pinned messages, each tap moves on to the next (older) one.
    setPinnedIndex((index) => (index + 1) % pinned.length);
  }

  function openReactions(message: ChatMessage, pageY: number) {
    if (message.pending) return;
    // Closing the keyboard moves the chat down by its height: place the bar where the
    // message ends up, not where it was when the finger went down.
    const keyboardHeight = Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0;
    Keyboard.dismiss();
    setPicker({ message, y: pageY + keyboardHeight });
  }

  function startReply(message: ChatMessage) {
    if (message.pending) return;
    setReplyTo(message);
    inputRef.current?.focus();
  }

  async function togglePin(message: ChatMessage) {
    if (message.pending) return;
    const previous = message.pinnedAt;
    const pin = previous === null;
    updateMessage(message.id, (m) => ({ ...m, pinnedAt: pin ? new Date().toISOString() : null })); // optimistic
    if (!pin) setPinned((current) => current.filter((m) => m.id !== message.id));
    try {
      await setMessagePinned(message.id, pin);
      reloadPinned();
    } catch {
      updateMessage(message.id, (m) => ({ ...m, pinnedAt: previous }));
      reloadPinned();
      setError(pin ? "Nachricht konnte nicht angeheftet werden." : "Nachricht konnte nicht gelöst werden.");
    }
  }

  /** Tapping my current emoji removes it, any other emoji replaces it. */
  async function react(message: ChatMessage, emoji: string) {
    setPicker(null);
    if (myId === undefined || message.pending) return;
    const current = message.reactions.find((r) => r.userId === myId)?.emoji ?? null;
    const next = current === emoji ? null : emoji;
    updateMessage(message.id, (m) => withReaction(m, myId, next)); // optimistic
    try {
      await setReaction(message, next);
    } catch {
      updateMessage(message.id, (m) => withReaction(m, myId, current));
      setError("Reaktion konnte nicht gespeichert werden.");
    }
  }

  async function send() {
    const body = draft.trim();
    if (body.length === 0 || myId === undefined) return;
    const quoted = replyTo;
    const temp: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId,
      senderId: myId,
      body,
      post: null,
      comment: null,
      replyTo: quoted !== null ? { id: quoted.id, senderId: quoted.senderId, text: messagePreview(quoted) } : null,
      pinnedAt: null,
      reactions: [],
      tag: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setDraft("");
    setReplyTo(null);
    setError(null);
    setMessages((current) => [temp, ...(current ?? [])]);
    try {
      const sent = await sendTextMessage(conversationId, body, quoted?.id ?? null);
      // Realtime may have delivered the real message already; drop the placeholder either way.
      setMessages((current) => mergeMessages((current ?? []).filter((m) => m.id !== temp.id), [sent]));
    } catch {
      setMessages((current) => (current ?? []).filter((m) => m.id !== temp.id));
      setDraft(body);
      setReplyTo(quoted);
      setError("Nachricht konnte nicht gesendet werden.");
    }
  }

  const canSend = draft.trim().length > 0;
  const currentPinned = pinned[pinnedIndex % Math.max(pinned.length, 1)];
  const pickerMessage = picker?.message;
  const myReaction =
    pickerMessage !== undefined ? (pickerMessage.reactions.find((r) => r.userId === myId)?.emoji ?? null) : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            partnerAvailable ? (
              <Pressable
                onPress={showChatMenu}
                accessibilityRole="button"
                accessibilityLabel="Weitere Optionen"
                hitSlop={spacing.sm}
                style={styles.headerButton}
              >
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
              </Pressable>
            ) : null,
          headerTitle: () =>
            partner !== null ? (
              <Pressable
                onPress={() => router.push({ pathname: "/user/[userId]", params: { userId: partner.id } })}
                disabled={!partnerAvailable}
                accessibilityRole="button"
                accessibilityLabel={`Profil von ${partner.username}`}
                style={styles.headerTitle}
              >
                <Avatar uri={partner.avatarUrl} username={partner.username} size={30} />
                <View>
                  <Text style={styles.headerName} numberOfLines={1}>
                    {partner.displayName}
                  </Text>
                  {partnerAvailable && (
                    <Text style={styles.handle} numberOfLines={1}>
                      @{partner.username}
                    </Text>
                  )}
                </View>
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={headerHeight}
      >
        {currentPinned !== undefined && (
          <View style={styles.pinnedBanner}>
            <Pressable
              onPress={openPinned}
              accessibilityRole="button"
              accessibilityLabel="Zur angehefteten Nachricht springen"
              style={styles.pinnedOpen}
            >
              <Ionicons name="pin" size={18} color={colors.accent} />
              <View style={styles.pinnedTextBox}>
                <Text style={styles.pinnedLabel}>
                  Angeheftet{pinned.length > 1 ? ` · ${(pinnedIndex % pinned.length) + 1}/${pinned.length}` : ""}
                </Text>
                <Text style={styles.pinnedText} numberOfLines={1}>
                  {messagePreview(currentPinned)}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => void togglePin(currentPinned)}
              accessibilityRole="button"
              accessibilityLabel="Nachricht lösen"
              hitSlop={spacing.sm}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {messages === null ? (
          <View style={styles.centered}>
            {error !== null ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <ActivityIndicator color={colors.accent} />
            )}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <SwipeableMessage
                mine={item.senderId === myId}
                pinned={item.pinnedAt !== null}
                onReply={() => startReply(item)}
                onTogglePin={() => void togglePin(item)}
                onLongPress={(y) => openReactions(item, y)}
              >
                <MessageBubble
                  message={item}
                  mine={item.senderId === myId}
                  myId={myId}
                  partnerName={partnerName}
                  highlighted={item.id === highlightedId}
                  onPressQuote={(id) => void jumpTo(id)}
                  onPressReaction={(emoji) => void react(item, emoji)}
                />
              </SwipeableMessage>
            )}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              // Rows have different heights: jump close, then retry once they are measured.
              listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5 }), 100);
            }}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.accent} /> : null}
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

        {replyTo !== null && (
          <View style={styles.replyBanner}>
            <View style={styles.replyAccent} />
            <View style={styles.replyTextBox}>
              <Text style={styles.replyLabel}>
                Antwort an @{replyTo.senderId === myId ? (myUsername ?? "") : partnerName}
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {messagePreview(replyTo)}
              </Text>
            </View>
            <Pressable
              onPress={() => setReplyTo(null)}
              accessibilityRole="button"
              accessibilityLabel="Antworten abbrechen"
              hitSlop={spacing.sm}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {blocked ? (
          <View style={[styles.blockedBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <Text style={styles.blockedText}>In diesem Chat können keine Nachrichten mehr gesendet werden.</Text>
          </View>
        ) : (
          <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <TaggedTextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              containerStyle={styles.inputBox}
              placeholder={replyTo !== null ? "Antwort…" : "Nachricht…"}
              placeholderTextColor={colors.textSecondary}
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
              <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      <ReactionPicker
        anchorY={picker?.y ?? null}
        current={myReaction}
        onPick={(emoji) => {
          if (pickerMessage !== undefined) void react(pickerMessage, emoji);
        }}
        onClose={() => setPicker(null)}
        onReport={
          pickerMessage !== undefined && pickerMessage.senderId !== myId
            ? () => {
                const reported = pickerMessage;
                setPicker(null);
                openReport({ targetType: "message", targetId: reported.id });
              }
            : undefined
        }
      />
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
    handle: {
      ...typography.label,
      fontWeight: "400",
      color: colors.textSecondary,
    },
    pinnedBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    pinnedOpen: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    pinnedTextBox: {
      flex: 1,
    },
    pinnedLabel: {
      color: colors.accent,
      fontSize: fontSize.sm - 1,
      fontWeight: "700",
    },
    pinnedText: {
      color: colors.text,
      fontSize: fontSize.sm,
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
      color: colors.textSecondary,
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
    replyBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    replyAccent: {
      width: 3,
      alignSelf: "stretch",
      borderRadius: radius.full,
      backgroundColor: colors.accent,
    },
    replyTextBox: {
      flex: 1,
    },
    replyLabel: {
      color: colors.text,
      fontSize: fontSize.sm - 1,
      fontWeight: "700",
    },
    replyText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
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
    inputBox: {
      flex: 1,
    },
    input: {
      minHeight: 40,
      maxHeight: 120,
      paddingHorizontal: spacing.md,
      paddingTop: 10,
      paddingBottom: 10,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceRaised,
      color: colors.text,
      fontSize: fontSize.md,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    sendDisabled: {
      opacity: 0.4,
    },
    headerButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    blockedBar: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.ms,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    blockedText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: "center",
    },
  }),
);
