import { router } from "expo-router";
import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { GRID_COLUMNS, PostGridRow, useTileWidth } from "@/components/profile/post-grid";
import { ProfileTabBar, type ProfileTab } from "@/components/profile/profile-tab-bar";
import { TrainingStatsPanel, useTrainingStatsState } from "@/components/profile/training-stats-panel";
import { ActivityRow } from "@/components/training/activity-row";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { spacing, typography } from "@/constants/theme";
import { useActivityActions } from "@/hooks/use-activity-actions";
import { usePagedList } from "@/hooks/use-paged-list";
import { makeStyles, useTheme } from "@/lib/theme";
import { fetchWorkoutsPage, type WorkoutListItem } from "@/lib/trainingRepo";
import { track, type UsageEvent } from "@/lib/usage";
import { fetchProfileGridPage, type PostThumbnail } from "@/lib/userProfileRepo";

const TAB_EVENTS: Record<ProfileTab, UsageEvent> = {
  posts: "profile_tab_posts",
  activities: "profile_tab_activities",
  stats: "profile_tab_stats",
  reposts: "profile_tab_reposts",
  tagged: "profile_tab_tagged",
};

type Row =
  | { key: string; kind: "header" }
  | { key: string; kind: "tabs" }
  | { key: string; kind: "locked" }
  | { key: string; kind: "grid"; posts: PostThumbnail[] }
  | { key: string; kind: "gridSkeleton" }
  | { key: string; kind: "activity"; item: WorkoutListItem; first: boolean }
  | { key: string; kind: "listSkeleton" }
  | { key: string; kind: "stats" }
  | { key: string; kind: "empty"; title: string; message?: string; action?: { label: string; onPress: () => void } }
  | { key: string; kind: "notice"; text: string }
  | { key: string; kind: "error"; retry: () => void };

type ProfileTabsListProps = {
  userId: string;
  isMe: boolean;
  /** Everything above the tabs (avatar, names, highlights, plans, …). */
  header: ReactElement;
  /** Private profile I don't follow: only this below the header, no tabs and no content. */
  locked?: ReactElement | null;
  /** The posts tab shows this instead of posts (e.g. posts only for followers). */
  postsHiddenText?: string | null;
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  /** Pull to refresh also reloads what the header shows. */
  onRefreshHeader?: () => void;
  /** Changes when posts changed elsewhere (new or deleted post): the posts tab reloads quietly. */
  postsVersion?: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/**
 * A profile as one scroll container: the header, the icon tabs (sticky) and the rows of the
 * active tab. Each tab loads on first open, pages by 30 and keeps its state while hidden.
 */
export function ProfileTabsList({
  userId,
  isMe,
  header,
  locked = null,
  postsHiddenText = null,
  tab,
  onTabChange,
  onRefreshHeader,
  postsVersion = 0,
}: ProfileTabsListProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tileWidth = useTileWidth();
  const showTabs = locked === null;

  const fetchPosts = useCallback((cursor: string | null) => fetchProfileGridPage(userId, cursor), [userId]);
  const fetchActivities = useCallback((cursor: string | null) => fetchWorkoutsPage(userId, cursor), [userId]);
  const posts = usePagedList(fetchPosts, showTabs && tab === "posts" && postsHiddenText === null);
  const activities = usePagedList(fetchActivities, showTabs && tab === "activities");
  const stats = useTrainingStatsState(userId, showTabs && tab === "stats");
  const activityActions = useActivityActions(activities.reload);

  // A new or deleted post elsewhere: reload the grid if it was opened already.
  const lastPostsVersion = useRef(postsVersion);
  const reloadPosts = posts.reload;
  useEffect(() => {
    if (lastPostsVersion.current === postsVersion) return;
    lastPostsVersion.current = postsVersion;
    reloadPosts();
  }, [postsVersion, reloadPosts]);

  function changeTab(next: ProfileTab) {
    if (next === tab) return;
    track(TAB_EVENTS[next]);
    onTabChange(next);
  }

  const rows: Row[] = [{ key: "header", kind: "header" }];
  if (!showTabs) {
    rows.push({ key: "locked", kind: "locked" });
  } else {
    rows.push({ key: "tabs", kind: "tabs" });
    switch (tab) {
      case "posts":
        if (postsHiddenText !== null) rows.push({ key: "posts-hidden", kind: "notice", text: postsHiddenText });
        else if (posts.items === null)
          rows.push(posts.failed ? { key: "posts-error", kind: "error", retry: posts.retry } : { key: "posts-skeleton", kind: "gridSkeleton" });
        else if (posts.items.length === 0)
          rows.push(
            isMe
              ? {
                  key: "posts-empty",
                  kind: "empty",
                  title: "Noch keine Beiträge",
                  message: "Teile ein Workout im Feed, dann erscheint es hier.",
                  action: { label: "Foto aufnehmen", onPress: () => router.navigate("/camera") },
                }
              : { key: "posts-empty", kind: "empty", title: "Noch keine Beiträge" },
          );
        else
          chunk(posts.items, GRID_COLUMNS).forEach((group, index) =>
            rows.push({ key: `grid-${index}-${group[0]?.key ?? ""}`, kind: "grid", posts: group }),
          );
        break;
      case "activities":
        if (activities.items === null)
          rows.push(
            activities.failed
              ? { key: "activities-error", kind: "error", retry: activities.retry }
              : { key: "activities-skeleton", kind: "listSkeleton" },
          );
        else if (activities.items.length === 0)
          rows.push(
            isMe
              ? {
                  key: "activities-empty",
                  kind: "empty",
                  title: "Noch keine Aktivitäten",
                  message: "Aufgezeichnete Trainings erscheinen hier, auch ohne Foto.",
                  action: { label: "Training starten", onPress: () => router.navigate("/training") },
                }
              : { key: "activities-empty", kind: "empty", title: "Noch keine Aktivitäten", message: "Hier gibt es nichts, was du sehen kannst." },
          );
        else
          activities.items.forEach((item, index) => rows.push({ key: `activity-${item.id}`, kind: "activity", item, first: index === 0 }));
        break;
      case "stats":
        rows.push({ key: "stats", kind: "stats" });
        break;
      case "reposts":
        rows.push(
          isMe
            ? {
                key: "reposts-empty",
                kind: "empty",
                title: "Noch keine Reposts",
                message: "Bist du bei einem Workout verlinkt, kannst du den Beitrag dort reposten.",
              }
            : { key: "reposts-empty", kind: "empty", title: "Noch keine Reposts" },
        );
        break;
      case "tagged":
        rows.push(
          isMe
            ? {
                key: "tagged-empty",
                kind: "empty",
                title: "Noch keine Markierungen",
                message: "Beiträge, in denen dich jemand markiert, erscheinen hier.",
              }
            : { key: "tagged-empty", kind: "empty", title: "Noch keine Markierungen" },
        );
        break;
    }
  }

  const activeList = tab === "posts" ? posts : tab === "activities" ? activities : null;

  function refresh() {
    onRefreshHeader?.();
    if (!showTabs) return;
    if (activeList !== null) activeList.refresh();
    else if (tab === "stats") stats.refresh();
  }

  function renderRow({ item: row }: { item: Row }) {
    switch (row.kind) {
      case "header":
        return header;
      case "tabs":
        return <ProfileTabBar value={tab} onChange={changeTab} />;
      case "locked":
        return locked;
      case "grid":
        return <PostGridRow posts={row.posts} />;
      case "gridSkeleton":
        return (
          <View style={styles.gridSkeleton} accessibilityLabel="Wird geladen" accessibilityRole="progressbar">
            {Array.from({ length: GRID_COLUMNS * 2 }, (_, index) => (
              <Skeleton key={index} width={tileWidth} height={tileWidth * 1.25} radius={0} />
            ))}
          </View>
        );
      case "activity":
        return (
          <View>
            {!row.first && <Divider />}
            <ActivityRow
              item={row.item}
              showStreakHint={isMe}
              onMenu={isMe ? () => activityActions.openMenu(row.item) : undefined}
              onPress={() => router.push({ pathname: "/workout/[id]", params: { id: row.item.id } })}
            />
          </View>
        );
      case "listSkeleton":
        return <ListSkeleton rows={4} avatar={false} />;
      case "stats":
        return <TrainingStatsPanel state={stats} isMe={isMe} />;
      case "empty":
        return <EmptyState title={row.title} message={row.message} action={row.action} />;
      case "notice":
        return <Text style={styles.notice}>{row.text}</Text>;
      case "error":
        return <ErrorState onRetry={row.retry} />;
    }
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={renderRow}
      stickyHeaderIndices={showTabs ? [1] : undefined}
      onEndReached={() => activeList?.loadMore()}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={activeList?.refreshing ?? false} onRefresh={refresh} tintColor={colors.textSecondary} />}
      ListFooterComponent={
        activeList?.loadingMore ? <ActivityIndicator style={styles.footer} color={colors.textSecondary} /> : null
      }
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingBottom: spacing.xl,
    },
    gridSkeleton: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 2,
    },
    notice: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: "center",
      padding: spacing.lg,
    },
    footer: {
      paddingVertical: spacing.md,
    },
  }),
);
