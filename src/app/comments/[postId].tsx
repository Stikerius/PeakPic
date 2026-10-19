import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
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
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { COMMENT_MAX_LENGTH, addComment, listComments } from "@/lib/commentRepo";
import { emitAppEvent } from "@/lib/events";
import { formatRelativeTime } from "@/lib/format";
import type { PostComment } from "@/types/social";

export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<PostComment>>(null);

  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listComments(postId)
      .then((result) => {
        if (active) setComments(result);
      })
      .catch(() => {
        if (active) setError("Kommentare konnten nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, [postId]);

  async function send() {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const comment = await addComment(postId, body);
      setComments((prev) => [...(prev ?? []), comment]);
      setDraft("");
      emitAppEvent("commentAdded", { postId });
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setError("Kommentar konnte nicht gesendet werden.");
    } finally {
      setSending(false);
    }
  }

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {comments === null ? (
        <View style={styles.centered}>
          {error !== null ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(comment) => comment.id}
          contentContainerStyle={comments.length === 0 ? styles.emptyContainer : styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.comment}>
              <Avatar uri={item.author.avatarUrl} username={item.author.username} size={32} />
              <View style={styles.commentBody}>
                <Text style={styles.commentText}>
                  <Text style={styles.username}>@{item.author.username} </Text>
                  {item.body}
                </Text>
                <Text style={styles.meta}>{formatRelativeTime(item.createdAt)}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Noch keine Kommentare. Schreib den ersten!</Text>
            </View>
          }
        />
      )}

      {comments !== null && error !== null && <Text style={styles.inlineError}>{error}</Text>}

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Kommentar schreiben…"
          placeholderTextColor={colors.textMuted}
          maxLength={COMMENT_MAX_LENGTH}
          multiline
          style={styles.input}
          accessibilityLabel="Kommentar"
        />
        <Pressable
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Kommentar senden"
          style={[styles.sendButton, !canSend && styles.sendDisabled]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons name="arrow-up" size={20} color={colors.text} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  list: {
    paddingVertical: spacing.sm,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  comment: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentText: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  username: {
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
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
