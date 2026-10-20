import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { PostGrid } from "@/components/profile/post-grid";
import { colors, fontSize, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { fetchHashtagPage, type HashtagPage } from "@/lib/hashtagRepo";

/** All posts with a hashtag that I may see, newest first. */
export default function HashtagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const [page, setPage] = useState<HashtagPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHashtagPage(tag)
      .then(setPage)
      .catch((loadError: unknown) => setError(describeError(loadError)));
  }, [tag]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `#${page?.tag ?? tag}` }} />
      {page === null ? (
        <View style={styles.centered}>
          {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>#{page.tag}</Text>
            <Text style={styles.count}>
              {page.useCount} {page.useCount === 1 ? "Verwendung" : "Verwendungen"}
            </Text>
          </View>
          <PostGrid posts={page.posts} emptyText="Noch keine Beiträge mit diesem Hashtag, die du sehen kannst." />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centered: {
    alignItems: "center",
    padding: spacing.xl,
  },
  header: {
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "800",
  },
  count: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
