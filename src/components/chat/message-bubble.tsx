import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SharedCommentCard } from "@/components/chat/shared-comment-card";
import { SharedPostCard } from "@/components/chat/shared-post-card";
import { TaggedText } from "@/components/tagged-text";
import { fontSize, radius, spacing } from "@/constants/theme";
import { formatTime } from "@/lib/format";
import { makeStyles, useTheme } from "@/lib/theme";
import type { ChatMessage } from "@/types/chat";

type MessageBubbleProps = {
  message: ChatMessage;
  mine: boolean;
  myId: string | undefined;
  partnerName: string;
  /** Briefly highlighted after jumping to it (quote or pinned banner). */
  highlighted?: boolean;
  onPressQuote?: (messageId: string) => void;
  onPressReaction?: (emoji: string) => void;
};

/** Reactions grouped by emoji, in the order they were first used. */
function groupReactions(message: ChatMessage, myId: string | undefined) {
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of message.reactions) {
    const group = groups.get(reaction.emoji) ?? { count: 0, mine: false };
    groups.set(reaction.emoji, { count: group.count + 1, mine: group.mine || reaction.userId === myId });
  }
  return [...groups.entries()];
}

export function MessageBubble({
  message,
  mine,
  myId,
  partnerName,
  highlighted = false,
  onPressQuote,
  onPressReaction,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reactions = groupReactions(message, myId);
  const quote = message.replyTo;

  // Block between the members: no content, only that a message was here.
  if (message.masked === true) {
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, styles.bubbleMasked]}>
          <Text style={styles.maskedText}>Nachricht gelöscht</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        message.pending && styles.pending,
        highlighted && styles.highlighted,
      ]}
    >
      {quote !== null && (
        <Pressable
          onPress={() => quote !== "deleted" && onPressQuote?.(quote.id)}
          disabled={quote === "deleted"}
          accessibilityRole="button"
          accessibilityLabel="Zur ursprünglichen Nachricht springen"
          style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}
        >
          {quote === "deleted" ? (
            <Text style={styles.quoteText}>Nachricht gelöscht</Text>
          ) : (
            <>
              <Text style={styles.quoteSender}>{quote.senderId === myId ? "Du" : partnerName}</Text>
              <Text style={styles.quoteText} numberOfLines={2}>
                {quote.text}
              </Text>
            </>
          )}
        </Pressable>
      )}
      {message.tag !== null && (
        <View style={[styles.tagHeader, mine ? styles.tagHeaderMine : null]}>
          <Ionicons name="pricetag" size={14} color={colors.warning} />
          <Text style={styles.tagText}>
            {mine
              ? `Du hast @${partnerName} markiert`
              : `@${partnerName} hat dich ${message.tag.on === "comment" ? "in einem Kommentar erwähnt" : "markiert"}`}
          </Text>
        </View>
      )}
      {message.tag?.on === "story" && (
        <Pressable
          onPress={() =>
            message.tag?.on === "story" &&
            router.push({
              pathname: "/stories/[userId]",
              params: { userId: message.senderId, only: "1", storyId: message.tag.storyId },
            })
          }

          accessibilityRole="button"
          accessibilityLabel="Story öffnen"
          style={styles.storyCard}
        >
          {message.tag.photoUrl !== null ? (
            <Image source={{ uri: message.tag.photoUrl }} style={styles.storyImage} contentFit="cover" />
          ) : (
            <View style={[styles.storyImage, styles.storyGone]}>
              <Text style={styles.storyGoneText}>Story nicht mehr verfügbar</Text>
            </View>
          )}
        </Pressable>
      )}
      {message.comment !== null ? (
        <SharedCommentCard comment={message.comment} post={message.post} />
      ) : (
        message.post !== null && <SharedPostCard post={message.post} />
      )}
      {message.body !== null && (
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <TaggedText text={message.body} style={[styles.body, mine && styles.bodyMine]} linkStyle={styles.bodyLink} />
        </View>
      )}
      {reactions.length > 0 && (
        <View style={[styles.reactions, mine && styles.reactionsMine]}>
          {reactions.map(([emoji, { count, mine: reactedByMe }]) => (
            <Pressable
              key={emoji}
              onPress={() => onPressReaction?.(emoji)}
              accessibilityRole="button"
              accessibilityLabel={`${emoji} ${count}${reactedByMe ? ", deine Reaktion" : ""}`}
              style={[styles.chip, reactedByMe && styles.chipMine]}
            >
              <Text style={styles.chipEmoji}>{emoji}</Text>
              {count > 1 && <Text style={styles.chipCount}>{count}</Text>}
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.meta}>
        {message.pinnedAt !== null && (
          <Ionicons name="pin" size={11} color={colors.textSecondary} accessibilityLabel="Angeheftet" />
        )}
        <Text style={styles.time}>{message.pending ? "Wird gesendet…" : formatTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      // The 80 % limit sits on the swipeable slot around the bubble (its long-press area).
      maxWidth: "100%",
      gap: 2,
      marginVertical: 3,
      borderRadius: radius.lg,
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
    highlighted: {
      backgroundColor: colors.accentSoft,
    },
    tagHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    tagHeaderMine: {
      alignSelf: "flex-end",
    },
    tagText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "600",
    },
    storyCard: {
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    storyImage: {
      width: 140,
      height: 224,
      backgroundColor: colors.surfaceRaised,
    },
    storyGone: {
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.sm,
    },
    storyGoneText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: "center",
    },
    quote: {
      maxWidth: "100%",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderLeftWidth: 3,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    quoteMine: {
      borderLeftColor: colors.accent,
    },
    quoteTheirs: {
      borderLeftColor: colors.textSecondary,
    },
    quoteSender: {
      color: colors.text,
      fontSize: fontSize.sm - 1,
      fontWeight: "700",
    },
    quoteText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    bubble: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
    },
    bubbleMine: {
      backgroundColor: colors.accent,
      borderBottomRightRadius: radius.sm,
    },
    bubbleTheirs: {
      backgroundColor: colors.surfaceRaised,
      borderBottomLeftRadius: radius.sm,
    },
    bubbleMasked: {
      borderWidth: 1,
      borderColor: colors.border,
    },
    maskedText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      fontStyle: "italic",
    },
    bodyLink: {
      textDecorationLine: "underline",
    },
    body: {
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: 21,
    },
    bodyMine: {
      color: colors.onAccent,
    },
    reactions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: -spacing.xs,
    },
    reactionsMine: {
      justifyContent: "flex-end",
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.background,
    },
    chipMine: {
      borderColor: colors.accent,
    },
    chipEmoji: {
      fontSize: 14,
    },
    chipCount: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "700",
    },
    meta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: spacing.xs,
    },
    time: {
      color: colors.textSecondary,
      fontSize: 11,
    },
  }),
);
