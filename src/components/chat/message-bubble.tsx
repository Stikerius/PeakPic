import { StyleSheet, Text, View } from "react-native";

import { SharedCommentCard } from "@/components/chat/shared-comment-card";
import { SharedPostCard } from "@/components/chat/shared-post-card";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { formatTime } from "@/lib/format";
import type { ChatMessage } from "@/types/chat";

export function MessageBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, message.pending && styles.pending]}>
      {message.comment !== null ? (
        <SharedCommentCard comment={message.comment} post={message.post} />
      ) : (
        message.post !== null && <SharedPostCard post={message.post} />
      )}
      {message.body !== null && (
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={styles.body}>{message.body}</Text>
        </View>
      )}
      <Text style={styles.time}>{message.pending ? "Wird gesendet…" : formatTime(message.createdAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    maxWidth: "80%",
    gap: 2,
    marginVertical: 3,
  },
  rowMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  rowTheirs: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  pending: {
    opacity: 0.6,
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceElevated,
    borderBottomLeftRadius: radius.sm,
  },
  body: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  time: {
    color: colors.textMuted,
    fontSize: 11,
    paddingHorizontal: spacing.xs,
  },
});
