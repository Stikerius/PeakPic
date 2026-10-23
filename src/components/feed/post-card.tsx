import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";

import { PhotoCarousel } from "@/components/feed/photo-carousel";
import { TaggedText } from "@/components/tagged-text";
import { Avatar } from "@/components/ui/avatar";
import { fontSize, spacing, typography } from "@/constants/theme";
import type { DoubleTapResult } from "@/lib/doubleTapLike";
import { formatRelativeTime } from "@/lib/format";
import { makeStyles, useTheme } from "@/lib/theme";
import type { FeedPost } from "@/types/social";

type PostCardProps = {
  post: FeedPost;
  onToggleLike: (postId: string) => void;
  /** Double tap on the photo: likes (never unlikes). For a repost this is the original post. */
  onDoubleTapLike?: (postId: string) => DoubleTapResult;
  onOpenComments: (postId: string) => void;
  onShare: (postId: string) => void;
  onOpenProfile: (userId: string) => void;
  /** Shown for my own posts: opens the edit/delete menu. */
  onMore?: (post: FeedPost) => void;
};

/** The heart below the post: filled when liked, with a short jump when a new like comes in. */
function LikeHeart({ liked }: { liked: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const wasLiked = useRef(liked);
  useEffect(() => {
    if (liked && !wasLiked.current && !reduced) {
      scale.value = withSequence(withTiming(1.3, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 }));
    }
    wasLiked.current = liked;
  }, [liked, reduced, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name={liked ? "heart" : "heart-outline"} size={26} color={liked ? colors.danger : colors.text} />
    </Animated.View>
  );
}

export function PostCard({ post, onToggleLike, onDoubleTapLike, onOpenComments, onShare, onOpenProfile, onMore }: PostCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const repost = post.repost;
  return (
    <View style={styles.card}>
      {repost !== null && (
        <View style={styles.repostBox}>
          <Pressable
            onPress={() => onOpenProfile(repost.reposter.id)}
            accessibilityRole="button"
            accessibilityLabel={`Profil von ${repost.reposter.username}`}
            style={styles.repostLine}
          >
            <Ionicons name="repeat" size={16} color={colors.textSecondary} />
            <Text style={styles.repostText}>
              <Text style={styles.repostName}>{repost.reposter.displayName}</Text> hat repostet
            </Text>
          </Pressable>
          {repost.caption !== null && <TaggedText text={repost.caption} style={styles.repostCaption} />}
        </View>
      )}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => onOpenProfile(post.author.id)}
          accessibilityRole="button"
          accessibilityLabel={`Profil von ${post.author.username}`}
          style={styles.header}
        >
          <Avatar uri={post.author.avatarUrl} username={post.author.username} size={36} />
          <View style={styles.headerText}>
            <Text style={styles.username} numberOfLines={1}>
              {post.author.displayName} <Text style={styles.handle}>@{post.author.username}</Text>
            </Text>
            <Text style={styles.meta}>
              {repost !== null ? "Original · " : ""}
              {formatRelativeTime(post.createdAt)}
              {post.planLabel !== null && ` · ${post.planLabel}`}
            </Text>
          </View>
        </Pressable>
        {onMore !== undefined && (
          <Pressable
            onPress={() => onMore(post)}
            accessibilityRole="button"
            accessibilityLabel="Post bearbeiten oder löschen"
            hitSlop={spacing.sm}
            style={styles.more}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        )}
      </View>

      <PhotoCarousel
        photoUrls={post.photoUrls}
        label={`Workout-Foto von ${post.author.username}`}
        recyclingKey={post.feedKey}
        mentions={post.photoMentions}
        onPressMention={onOpenProfile}
        like={onDoubleTapLike !== undefined ? { liked: post.likedByMe, onDoubleTap: () => onDoubleTapLike(post.id) } : undefined}
      />

      <View style={styles.actions}>
        <Pressable
          onPress={() => onToggleLike(post.id)}
          accessibilityRole="button"
          accessibilityLabel={post.likedByMe ? "Like entfernen" : "Liken"}
          accessibilityState={{ selected: post.likedByMe }}
          hitSlop={spacing.sm}
          style={styles.action}
        >
          <LikeHeart liked={post.likedByMe} />
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

      {post.tags.length > 0 && (
        <View style={styles.tags}>
          <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.tagsText}>
            Mit{" "}
            {post.tags.map((person, index) => (
              <Text key={person.id}>
                {index > 0 ? ", " : ""}
                <Text
                  style={styles.tagName}
                  onPress={() => onOpenProfile(person.id)}
                  accessibilityRole="link"
                >
                  @{person.username}
                </Text>
              </Text>
            ))}
          </Text>
        </View>
      )}

      {post.caption !== null && (
        <Text style={styles.caption}>
          <Text style={styles.username}>{post.author.displayName} </Text>
          <TaggedText text={post.caption} />
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      paddingBottom: spacing.lg,
    },
    repostBox: {
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    repostLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    repostText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    repostName: {
      color: colors.text,
      fontWeight: "700",
    },
    repostCaption: {
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: 21,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    header: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    more: {
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
    handle: {
      ...typography.caption,
      fontWeight: "400",
      color: colors.textSecondary,
    },
    meta: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
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
    tags: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    tagsText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    tagName: {
      color: colors.text,
      fontWeight: "700",
    },
    caption: {
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: 21,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  }),
);
