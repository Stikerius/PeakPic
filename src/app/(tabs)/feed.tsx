import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useNavigation } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from "react-native";

import { PostCard } from "@/components/feed/post-card";
import { OfficialCard } from "@/components/surveys/official-card";
import { StoryBar } from "@/components/stories/story-bar";
import { Button } from "@/components/ui/button";
import { fontSize, radius, spacing } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { useOtherPostActions } from "@/hooks/use-other-post-actions";
import { usePostActions, useRepostActions } from "@/hooks/use-post-actions";
import { useSession } from "@/lib/session";
import { useFeed } from "@/hooks/use-feed";
import { useOfficialFeed } from "@/hooks/use-official-feed";
import { useOfficialAccountId } from "@/lib/officialAccount";
import { mergeFeed, type FeedEntry } from "@/lib/surveyFeed";
import { refreshStories } from "@/lib/storyStore";
import { makeStyles, useTheme } from "@/lib/theme";
import { useTrackScreen } from "@/lib/usage";

/** The bits of the tab navigator this screen needs; expo-router doesn't export its tab types. */
type TabScreenNavigation = {
  addListener(type: "tabPress", callback: () => void): () => void;
  isFocused(): boolean;
};

export default function FeedScreen() {
  useTrackScreen("screen_feed");
  const { colors } = useTheme();
  const styles = useStyles();
  const { posts, status, error, hasMore, refresh, loadMore, toggleLike, likeByDoubleTap, dismissError } = useFeed();
  const listRef = useRef<FlatList<FeedEntry>>(null);
  // Surveys and results of the official account, put between the posts by date.
  const official = useOfficialFeed();
  const officialId = useOfficialAccountId();
  const entries = useMemo(() => mergeFeed(posts, official.feed, hasMore), [posts, official.feed, hasMore]);
  // A card counts as seen after a second on screen (not when scrolling past quickly). FlatList
  // needs these once; markSeen is stable.
  const { markSeen } = official;
  const [viewabilityPairs] = useState(() => [
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 60, minimumViewTime: 1000 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken<FeedEntry>[] }) => {
        for (const token of viewableItems) {
          if (token.isViewable && token.item.type === "official") markSeen(token.item.item);
        }
      },
    },
  ]);
  const navigation = useNavigation<TabScreenNavigation>();
  const openProfile = useOpenProfile();
  const showPostActions = usePostActions();
  const showRepostActions = useRepostActions();
  const myId = useSession().session?.user.id;
  const showOtherPostActions = useOtherPostActions();

  // Tapping the feed tab while it's open scrolls to the top and refreshes, like Instagram.
  useEffect(() => {
    return navigation.addListener("tabPress", () => {
      if (!navigation.isFocused()) return;
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      void refresh();
      void refreshStories();
      void official.reload();
    });
  }, [navigation, refresh, official]);

  if (status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {error !== null && (
        <Pressable onPress={dismissError} style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Ionicons name="close" size={18} color={colors.text} />
        </Pressable>
      )}
      <FlatList
        ref={listRef}
        data={entries}
        keyExtractor={(entry) => entry.key}
        viewabilityConfigCallbackPairs={viewabilityPairs}
        renderItem={({ item: entry }) => {
          if (entry.type === "official") {
            const card = entry.item;
            return (
              <OfficialCard
                item={card}
                onOpen={() =>
                  card.kind === "survey"
                    ? router.push({ pathname: "/survey/[surveyId]", params: { surveyId: card.surveyId } })
                    : router.push({ pathname: "/results/[itemId]", params: { itemId: card.itemId } })
                }
                onOpenProfile={typeof officialId === "string" ? () => router.push({ pathname: "/user/[userId]", params: { userId: officialId } }) : undefined}
                onLater={card.kind === "survey" && !card.pinUntilAnswered ? () => official.later(card) : undefined}
                onDismiss={() => official.dismiss(card)}
              />
            );
          }
          const item = entry.post;
          return (
          <PostCard
            post={item}
            onToggleLike={(id) => void toggleLike(id)}
            onDoubleTapLike={likeByDoubleTap}
            onOpenComments={(id) =>
              router.push({ pathname: "/comments/[postId]", params: { postId: id } })
            }
            onOpenProfile={openProfile}
            onShare={(id) => router.push({ pathname: "/share/[postId]", params: { postId: id } })}
            onMore={
              item.repost !== null
                ? item.repost.reposter.id === myId
                  ? (post) => post.repost !== null && showRepostActions(post.repost.id)
                  : showOtherPostActions
                : item.author.id === myId
                  ? showPostActions
                  : showOtherPostActions
            }
          />
          );
        }}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={<StoryBar />}
        refreshControl={
          <RefreshControl
            refreshing={status === "refreshing"}
            onRefresh={() => {
              void refresh();
              void refreshStories();
              void official.reload();
            }}
            tintColor={colors.accent}
          />
        }
        ListFooterComponent={
          status === "loadingMore" ? (
            <ActivityIndicator style={styles.footer} color={colors.accent} />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={56} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>Noch nichts zu sehen</Text>
            <Text style={styles.emptyBody}>
              Folge Freunden, um ihre Workouts hier zu sehen, oder poste dein erstes Foto.
            </Text>
            <Button label="Leute finden" onPress={() => router.push("/search")} />
          </View>
        }
        contentContainerStyle={entries.length === 0 ? styles.emptyContainer : undefined}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      margin: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
    },
    errorText: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.sm,
    },
    footer: {
      paddingVertical: spacing.lg,
    },
    emptyContainer: {
      flexGrow: 1,
    },
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
    emptyBody: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
      lineHeight: 22,
    },
  }),
);
