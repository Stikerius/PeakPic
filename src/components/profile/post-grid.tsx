import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { fontSize, onPhoto, radius, spacing, typography } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";
import type { PostThumbnail } from "@/lib/userProfileRepo";

const COLUMNS = 3;
const GAP = 2;

type PostGridProps = {
  posts: PostThumbnail[];
  emptyText: string;
};

export const GRID_COLUMNS = COLUMNS;

/** One tile: photo, plan label, carousel or repost icon. Tap opens the post (for reposts the original). */
export function PostTile({ post, width }: { post: PostThumbnail; width: number }) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/post/[postId]", params: { postId: post.id } })}
      accessibilityRole="button"
      accessibilityLabel={
        post.isRepost ? "Repost öffnen" : post.photoCount > 1 ? `Slideshow mit ${post.photoCount} Bildern öffnen` : "Post öffnen"
      }
      style={{ width, height: width * 1.25 }}
    >
      {post.photoUrl !== null ? (
        <Image source={{ uri: post.photoUrl }} style={styles.tile} contentFit="cover" transition={100} />
      ) : (
        <View style={[styles.tile, styles.missing]} />
      )}
      {post.planTitle !== null && (
        <View style={styles.planLabel} pointerEvents="none">
          <Text style={styles.planLabelText} numberOfLines={1}>
            {post.planTitle}
          </Text>
        </View>
      )}
      {(post.isRepost || post.photoCount > 1) && (
        <View style={styles.badge} pointerEvents="none">
          <Ionicons name={post.isRepost ? "repeat" : "copy"} size={16} color={onPhoto.text} />
        </View>
      )}
    </Pressable>
  );
}

/** Width of a tile in a full-width 3-column grid. */
export function useTileWidth(): number {
  const { width } = useWindowDimensions();
  return (width - GAP * (COLUMNS - 1)) / COLUMNS;
}

/** One row of up to three tiles, for grids inside a FlatList (one scroll container per screen). */
export function PostGridRow({ posts }: { posts: PostThumbnail[] }) {
  const styles = useStyles();
  const tileWidth = useTileWidth();
  return (
    <View style={[styles.grid, styles.row]}>
      {posts.map((post) => (
        <PostTile key={post.key} post={post} width={tileWidth} />
      ))}
    </View>
  );
}

/**
 * 3-column grid (4:5 tiles) as plain views, for short lists (hashtag page); slideshows get a
 * carousel icon, reposts a repost icon.
 */
export function PostGrid({ posts, emptyText }: PostGridProps) {
  const styles = useStyles();
  const tileWidth = useTileWidth();

  if (posts.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;

  return (
    <View style={styles.grid}>
      {posts.map((post) => (
        <PostTile key={post.key} post={post} width={tileWidth} />
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: GAP,
    },
    row: {
      marginBottom: GAP,
    },
    tile: {
      width: "100%",
      height: "100%",
      backgroundColor: colors.surface,
    },
    missing: {
      backgroundColor: colors.surfaceRaised,
    },
    badge: {
      position: "absolute",
      top: 6,
      right: 6,
      shadowColor: onPhoto.background,
      shadowOpacity: 0.5,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    empty: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
      paddingHorizontal: spacing.md,
    },
    planLabel: {
      position: "absolute",
      left: spacing.xs,
      bottom: spacing.xs,
      maxWidth: "85%",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
      backgroundColor: onPhoto.scrim,
    },
    planLabelText: {
      ...typography.label,
      color: onPhoto.text,
    },
  }),
);
