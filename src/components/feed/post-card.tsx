import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { colors, fontSize, spacing } from "@/constants/theme";
import { formatRelativeTime } from "@/lib/format";
import type { FeedPost } from "@/types/social";

type PostCardProps = {
  post: FeedPost;
  onToggleLike: (postId: string) => void;
  onOpenComments: (postId: string) => void;
  onShare: (postId: string) => void;
};

export function PostCard({ post, onToggleLike, onOpenComments, onShare }: PostCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar uri={post.author.avatarUrl} username={post.author.username} size={36} />
        <View style={styles.headerText}>
          <Text style={styles.username}>@{post.author.username}</Text>
          <Text style={styles.meta}>{formatRelativeTime(post.createdAt)}</Text>
        </View>
      </View>

      {post.photoUrl !== null ? (
        <Image
          source={{ uri: post.photoUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
          recyclingKey={post.id}
          accessibilityLabel={`Workout-Foto von ${post.author.username}`}
        />
      ) : (
        <View style={[styles.photo, styles.photoMissing]}>
          <Ionicons name="image-outline" size={40} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => onToggleLike(post.id)}
          accessibilityRole="button"
          accessibilityLabel={post.likedByMe ? "Like entfernen" : "Liken"}
          accessibilityState={{ selected: post.likedByMe }}
          hitSlop={spacing.sm}
          style={styles.action}
        >
          <Ionicons
            name={post.likedByMe ? "heart" : "heart-outline"}
            size={26}
            color={post.likedByMe ? colors.danger : colors.text}
          />
          {post.likeCount > 0 && <Text style={styles.count}>{post.likeCount}</Text>}
        </Pressable>
        <Pressable
          onPress={() => onOpenComments(post.id)}
          accessibilityRole="button"
          accessibilityLabel={`Kommentare (${post.commentCount})`}
          hitSlop={spacing.sm}
          style={styles.action}
        >
          <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          {post.commentCount > 0 && <Text style={styles.count}>{post.commentCount}</Text>}
        </Pressable>
        <Pressable
          onPress={() => onShare(post.id)}
          accessibilityRole="button"
          accessibilityLabel="An einen Chat senden"
          hitSlop={spacing.sm}
          style={styles.action}
        >
          <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      {post.caption !== null && (
        <Text style={styles.caption}>
          <Text style={styles.username}>@{post.author.username} </Text>
          {post.caption}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  username: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  photo: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: colors.surface,
  },
  photoMissing: {
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  count: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  caption: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 21,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
