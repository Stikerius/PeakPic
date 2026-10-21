import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { PhotoCarousel } from "@/components/feed/photo-carousel";
import { TaggedTextInput } from "@/components/tagged-text-input";
import { fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { fetchPost } from "@/lib/feedRepo";
import { REPOST_CAPTION_MAX_LENGTH, createRepost } from "@/lib/repostRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { FeedPost } from "@/types/social";

/**
 * "Selbst posten": a linked person reposts the original workout with an optional caption.
 * Only possible after accepting the workout link, for posts that are in the feed (the
 * database checks both). The repost points at the original; no photos are copied.
 */
export default function RepostScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPost(postId)
      .then(setPost)
      .catch(() => setPost(null));
  }, [postId]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await createRepost(postId, caption);
      emitAppEvent("postCreated", undefined);
      router.back();
    } catch (repostError) {
      setError(`Repost nicht möglich – ${describeError(repostError)}`);
    } finally {
      setSaving(false);
    }
  }

  if (post === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (post === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Dieser Post ist nicht mehr verfügbar.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.original}>
          <View style={styles.originalHeader}>
            <Avatar uri={post.author.avatarUrl} username={post.author.username} size={28} />
            <Text style={styles.originalLabel}>Original von @{post.author.username}</Text>
          </View>
          <PhotoCarousel photoUrls={post.photoUrls} label={`Workout von ${post.author.username}`} />
        </View>
        <TaggedTextInput
          value={caption}
          onChangeText={setCaption}
          suggestionsPlacement="below"
          placeholder="Eigene Beschriftung (optional)"
          placeholderTextColor={colors.textSecondary}
          maxLength={REPOST_CAPTION_MAX_LENGTH}
          multiline
          style={styles.input}
          accessibilityLabel="Beschriftung für den Repost"
        />
        <Text style={styles.muted}>
          Dein Repost zeigt deutlich, dass das Workout von @{post.author.username} ist. Er zählt nicht zusätzlich für
          deinen Streak und ist nur für Leute sichtbar, die auch das Original sehen dürfen.
        </Text>
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <Button label="Selbst posten" onPress={() => void submit()} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: spacing.md,
      gap: spacing.md,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    original: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: colors.surface,
    },
    originalHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
    },
    originalLabel: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "700",
    },
    input: {
      minHeight: 80,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.md,
      textAlignVertical: "top",
    },
    muted: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      lineHeight: 19,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.sm,
    },
  }),
);
