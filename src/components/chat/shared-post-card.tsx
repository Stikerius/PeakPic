import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { fontSize, radius, spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";
import type { SharedPost } from "@/types/chat";

const CARD_WIDTH = 220;

/** Preview of a post shared in a chat; tapping opens the post. */
export function SharedPostCard({ post }: { post: SharedPost | "deleted" }) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (post === "deleted") {
    return (
      <View style={[styles.card, styles.deleted]}>
        <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
        <Text style={styles.deletedText}>Post nicht mehr verfügbar</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/post/[postId]", params: { postId: post.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Post von ${post.author.username} öffnen`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <Avatar uri={post.author.avatarUrl} username={post.author.username} size={24} />
        <Text style={styles.username} numberOfLines={1}>
          @{post.author.username}
        </Text>
      </View>
      {post.photoUrl !== null ? (
        <Image source={{ uri: post.photoUrl }} style={styles.photo} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.photo, styles.photoMissing]}>
          <Ionicons name="image-outline" size={32} color={colors.textSecondary} />
        </View>
      )}
      {post.caption !== null && (
        <Text style={styles.caption} numberOfLines={2}>
          {post.caption}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      width: CARD_WIDTH,
      borderRadius: radius.lg,
      overflow: "hidden",
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
      padding: spacing.sm,
    },
    username: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: "700",
    },
    photo: {
      width: CARD_WIDTH,
      aspectRatio: 4 / 5,
      backgroundColor: colors.surfaceRaised,
    },
    photoMissing: {
      alignItems: "center",
      justifyContent: "center",
    },
    caption: {
      color: colors.text,
      fontSize: fontSize.sm,
      padding: spacing.sm,
    },
    deleted: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
    },
    deletedText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontStyle: "italic",
    },
  }),
);
