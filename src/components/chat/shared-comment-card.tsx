import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import type { SharedComment, SharedPost } from "@/types/chat";

const CARD_WIDTH = 240;
const THUMB_SIZE = 44;

type SharedCommentCardProps = {
  comment: SharedComment;
  /** The comment's post, for the thumbnail; "deleted" or null if it is gone. */
  post: SharedPost | "deleted" | null;
};

/** A comment shared in a chat: text and author; tapping opens its post. */
export function SharedCommentCard({ comment, post }: SharedCommentCardProps) {
  const photoUrl = post !== null && post !== "deleted" ? post.photoUrl : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/post/[postId]", params: { postId: comment.postId } })}
      accessibilityRole="button"
      accessibilityLabel={`Kommentar von ${comment.author.username}: ${comment.body}. Post öffnen`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <Avatar uri={comment.author.avatarUrl} username={comment.author.username} size={24} />
        <Text style={styles.username} numberOfLines={1}>
          @{comment.author.username}
        </Text>
        {photoUrl !== null && <Image source={{ uri: photoUrl }} style={styles.thumb} contentFit="cover" />}
      </View>
      <Text style={styles.body} numberOfLines={5}>
        {comment.body}
      </Text>
      <View style={styles.footer}>
        <Ionicons name="chatbubble-outline" size={14} color={colors.textMuted} />
        <Text style={styles.footerText}>Kommentar · Post ansehen</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  username: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
  },
  body: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  footerText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
});
