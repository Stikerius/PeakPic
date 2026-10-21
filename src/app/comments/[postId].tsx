import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  useWindowDimensions,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { SlideInDown, interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReport } from "@/components/moderation/report-provider";
import { TaggedText } from "@/components/tagged-text";
import { TaggedTextInput } from "@/components/tagged-text-input";
import { Avatar } from "@/components/ui/avatar";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import { showActionSheet } from "@/lib/actionSheet";
import { COMMENT_MAX_LENGTH, addComment, listComments, setCommentLiked } from "@/lib/commentRepo";
import { emitAppEvent } from "@/lib/events";
import { formatRelativeTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";
import type { PostComment } from "@/types/social";

/** Sheet height as a fraction of the screen. */
const SHEET_HEIGHT = 0.75;
/** How long a comment opened from a chat stays highlighted. */
const HIGHLIGHT_MS = 2500;

type ReplyTarget = { parentId: string; username: string };

type CommentRowProps = {
  comment: PostComment;
  isReply: boolean;
  highlighted: boolean;
  onOpenProfile: (userId: string) => void;
  onToggleLike: (comment: PostComment) => void;
  onReply: (comment: PostComment) => void;
  onLongPress: (comment: PostComment) => void;
};

function CommentRow({ comment, isReply, highlighted, onOpenProfile, onToggleLike, onReply, onLongPress }: CommentRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onLongPress={() => onLongPress(comment)}
      accessibilityHint="Lange drücken für weitere Aktionen"
      style={({ pressed }) => [
        styles.comment,
        isReply && styles.reply,
        (pressed || highlighted) && styles.commentHighlighted,
      ]}
    >
      <Pressable
        onPress={() => onOpenProfile(comment.author.id)}
        accessibilityRole="button"
        accessibilityLabel={`Profil von ${comment.author.username}`}
      >
        <Avatar uri={comment.author.avatarUrl} username={comment.author.username} size={isReply ? 26 : 32} />
      </Pressable>
      <View style={styles.commentBody}>
        <Text style={styles.commentText}>
          <Text style={styles.username} onPress={() => onOpenProfile(comment.author.id)}>
            {comment.author.displayName} <Text style={styles.handle}>@{comment.author.username}</Text>{" "}
          </Text>
          <TaggedText text={comment.body} />
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatRelativeTime(comment.createdAt)}</Text>
          <Pressable onPress={() => onReply(comment)} accessibilityRole="button" hitSlop={spacing.xs}>
            <Text style={styles.metaAction}>Antworten</Text>
          </Pressable>
        </View>
      </View>
      <Pressable
        onPress={() => onToggleLike(comment)}
        accessibilityRole="button"
        accessibilityLabel={comment.likedByMe ? "Like entfernen" : "Kommentar liken"}
        accessibilityState={{ selected: comment.likedByMe }}
        hitSlop={spacing.sm}
        style={styles.like}
      >
        <Ionicons
          name={comment.likedByMe ? "heart" : "heart-outline"}
          size={16}
          color={comment.likedByMe ? colors.danger : colors.textSecondary}
        />
        {comment.likeCount > 0 && <Text style={styles.likeCount}>{comment.likeCount}</Text>}
      </Pressable>
    </Pressable>
  );
}

export default function CommentsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const myId = useSession().session?.user.id;
  const { openReport } = useReport();
  // commentId: opened from a shared comment in a chat; scroll to it and highlight it.
  const { postId, commentId } = useLocalSearchParams<{ postId: string; commentId?: string }>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const listRef = useRef<FlatList<PostComment>>(null);
  const inputRef = useRef<TextInput>(null);
  const openProfile = useOpenProfile();

  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // The linked comment (commentId) was deleted meanwhile.
  const [linkedMissing, setLinkedMissing] = useState(false);

  const sheetHeight = height * SHEET_HEIGHT;
  const swipe = useSwipeToDismiss({ onDismiss: () => router.back(), fadeTo: 1 });
  // Only the shared value may go into the worklet; the swipe object also holds the gesture.
  const { translateY } = swipe;
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight], [1, 0], "clamp"),
  }));

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

  const { topLevel, replies } = useMemo(() => {
    const byParent = new Map<string, PostComment[]>();
    const roots: PostComment[] = [];
    for (const comment of comments ?? []) {
      if (comment.parentId === null) {
        roots.push(comment);
      } else {
        byParent.set(comment.parentId, [...(byParent.get(comment.parentId) ?? []), comment]);
      }
    }
    return { topLevel: roots, replies: byParent };
  }, [comments]);

  // Opened from a chat: expand the thread, scroll to the comment and highlight it once.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || commentId === undefined || comments === null) return;
    focusedOnce.current = true;
    const target = comments.find((c) => c.id === commentId);
    if (target === undefined) {
      setLinkedMissing(true);
      return;
    }
    const rootId = target.parentId ?? target.id;
    if (target.parentId !== null) setExpanded((prev) => new Set(prev).add(rootId));
    setHighlightedId(target.id);
    const index = topLevel.findIndex((c) => c.id === rootId);
    if (index > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true }));
    }
    setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
  }, [commentId, comments, topLevel]);

  function updateComment(id: string, change: (comment: PostComment) => PostComment) {
    setComments((prev) => prev?.map((c) => (c.id === id ? change(c) : c)) ?? prev);
  }

  function toggleLike(comment: PostComment) {
    const liked = !comment.likedByMe;
    const apply = (value: boolean) =>
      updateComment(comment.id, (c) => ({
        ...c,
        likedByMe: value,
        likeCount: Math.max(0, c.likeCount + (value ? 1 : -1)),
      }));
    apply(liked); // optimistic
    setCommentLiked(comment.id, liked).catch(() => apply(!liked));
  }

  function startReply(comment: PostComment) {
    // Replies stay one level deep: answering a reply goes to its top-level comment.
    setReplyTo({ parentId: comment.parentId ?? comment.id, username: comment.author.username });
    setDraft(`@${comment.author.username} `);
    inputRef.current?.focus();
  }

  function shareComment(comment: PostComment) {
    router.push({ pathname: "/share/[postId]", params: { postId, commentId: comment.id } });
  }

  function showActions(comment: PostComment) {
    showActionSheet(`@${comment.author.username}`, [
      { label: "An Chat senden", onPress: () => shareComment(comment) },
      { label: "Antworten", onPress: () => startReply(comment) },
      ...(comment.author.id !== myId
        ? [
            {
              label: "Kommentar melden",
              destructive: true,
              onPress: () => openReport({ targetType: "comment", targetId: comment.id }),
            },
          ]
        : []),
    ]);
  }

  function toggleReplies(parentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  async function send() {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const parentId = replyTo?.parentId ?? null;
      const comment = await addComment(postId, body, parentId);
      setComments((prev) => [...(prev ?? []), comment]);
      setDraft("");
      setReplyTo(null);
      emitAppEvent("commentAdded", { postId });
      if (parentId !== null) {
        setExpanded((prev) => new Set(prev).add(parentId));
      } else {
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      }
    } catch {
      setError("Kommentar konnte nicht gesendet werden.");
    } finally {
      setSending(false);
    }
  }

  const canSend = draft.trim().length > 0 && !sending;
  const rowProps = {
    onOpenProfile: openProfile,
    onToggleLike: toggleLike,
    onReply: startReply,
    onLongPress: showActions,
  };

  return (
    <View style={styles.screen}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Kommentare schliessen"
        />
      </Animated.View>

      <KeyboardAvoidingView
        style={[styles.keyboard, { paddingTop: insets.top + spacing.lg }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
      >
        <Animated.View entering={SlideInDown.duration(250)} style={[styles.sheetFrame, { height: sheetHeight }]}>
          <Animated.View style={[styles.sheet, swipe.animatedStyle]}>
            <GestureDetector gesture={swipe.gesture}>
              <View style={styles.handleArea} collapsable={false}>
                <View style={styles.grabber} />
                <Text style={styles.title}>Kommentare</Text>
              </View>
            </GestureDetector>

            {comments === null ? (
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
                data={topLevel}
                keyExtractor={(comment) => comment.id}
                contentContainerStyle={topLevel.length === 0 ? styles.emptyContainer : styles.list}
                keyboardShouldPersistTaps="handled"
                onScrollToIndexFailed={({ index, averageItemLength }) => {
                  // Rows have different heights: jump close, then retry once they are measured.
                  listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
                  setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.3 }), 100);
                }}
                renderItem={({ item }) => {
                  const threadReplies = replies.get(item.id) ?? [];
                  const open = expanded.has(item.id);
                  return (
                    <View>
                      <CommentRow
                        comment={item}
                        isReply={false}
                        highlighted={item.id === highlightedId}
                        {...rowProps}
                      />
                      {threadReplies.length > 0 && (
                        <Pressable
                          onPress={() => toggleReplies(item.id)}
                          accessibilityRole="button"
                          style={styles.toggleReplies}
                        >
                          <View style={styles.toggleLine} />
                          <Text style={styles.toggleText}>
                            {open ? "Antworten ausblenden" : `Antworten ansehen (${threadReplies.length})`}
                          </Text>
                        </Pressable>
                      )}
                      {open &&
                        threadReplies.map((reply) => (
                          <CommentRow
                            key={reply.id}
                            comment={reply}
                            isReply
                            highlighted={reply.id === highlightedId}
                            {...rowProps}
                          />
                        ))}
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.centered}>
                    <Text style={styles.emptyText}>Noch keine Kommentare. Schreib den ersten!</Text>
                  </View>
                }
              />
            )}

            {linkedMissing && (
              <Text style={styles.inlineError}>Dieser Kommentar ist nicht mehr verfügbar.</Text>
            )}
            {comments !== null && error !== null && <Text style={styles.inlineError}>{error}</Text>}

            {replyTo !== null && (
              <View style={styles.replyBanner}>
                <Text style={styles.replyText} numberOfLines={1}>
                  Antwort an @{replyTo.username}
                </Text>
                <Pressable
                  onPress={() => {
                    setReplyTo(null);
                    setDraft("");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Antworten abbrechen"
                  hitSlop={spacing.sm}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            )}

            <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
              <TaggedTextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                containerStyle={styles.inputBox}
                placeholder={replyTo !== null ? "Antwort schreiben…" : "Kommentar schreiben…"}
                placeholderTextColor={colors.textSecondary}
                maxLength={COMMENT_MAX_LENGTH}
                multiline
                style={styles.input}
                accessibilityLabel={replyTo !== null ? "Antwort" : "Kommentar"}
              />
              <Pressable
                onPress={() => void send()}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel={replyTo !== null ? "Antwort senden" : "Kommentar senden"}
                style={[styles.sendButton, !canSend && styles.sendDisabled]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.onAccent} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
                )}
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
    },
    backdrop: {
      backgroundColor: colors.backdrop,
    },
    keyboard: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheetFrame: {
      flexShrink: 1,
    },
    sheet: {
      flex: 1,
      overflow: "hidden",
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      backgroundColor: colors.background,
    },
    handleArea: {
      alignItems: "center",
      gap: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    grabber: {
      width: 40,
      height: 5,
      borderRadius: radius.full,
      backgroundColor: colors.border,
    },
    title: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "700",
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
    reply: {
      paddingLeft: spacing.md + 32 + spacing.sm,
      paddingVertical: spacing.xs,
    },
    commentHighlighted: {
      backgroundColor: colors.surfaceRaised,
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
    handle: {
      ...typography.caption,
      fontWeight: "400",
      color: colors.textSecondary,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    meta: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    metaAction: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "700",
    },
    like: {
      alignItems: "center",
      paddingTop: 2,
      minWidth: 24,
    },
    likeCount: {
      color: colors.textSecondary,
      fontSize: 11,
    },
    toggleReplies: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingLeft: spacing.md + 32 + spacing.sm,
      paddingVertical: spacing.xs,
    },
    toggleLine: {
      width: 24,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.textSecondary,
    },
    toggleText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "700",
    },
    emptyText: {
      color: colors.textSecondary,
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
    replyBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surfaceRaised,
    },
    replyText: {
      flex: 1,
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
  }),
);
