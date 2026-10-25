import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import type { OfficialItem } from "../../../shared/surveys";
import { OfficialBadge } from "@/components/surveys/official-badge";
import { OfficialCard } from "@/components/surveys/official-card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ListSkeleton } from "@/components/ui/skeleton";
import { spacing, typography } from "@/constants/theme";
import { onAppEvent } from "@/lib/events";
import { getSignedPhotoUrl } from "@/lib/photoUpload";
import { fetchOfficialProfile, fetchOfficialProfileItems, trackSurveyEvent, type OfficialProfile } from "@/lib/surveyRepo";
import { makeStyles, useTheme } from "@/lib/theme";

type Tab = "surveys" | "results";
const TABS: { value: Tab; label: string }[] = [
  { value: "surveys", label: "Umfragen" },
  { value: "results", label: "Auswertungen" },
];

/**
 * The official account's own profile view: name, picture, description and badge, tabs
 * "Umfragen" (running and earlier ones within their profile time) and "Auswertungen". It never
 * shows e-mail or account data, follower lists, activities, statistics, plans or a chat button.
 */
export function OfficialProfileView() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [profile, setProfile] = useState<OfficialProfile | null | undefined>(undefined);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("surveys");
  const [items, setItems] = useState<OfficialItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchOfficialProfile()
      .then((result) => {
        if (!active) return;
        setProfile(result);
        if (result?.avatarPath != null) void getSignedPhotoUrl(result.avatarPath).then((url) => active && setAvatarUrl(url)).catch(() => undefined);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    trackSurveyEvent(null, "profile_tab_opened");
    fetchOfficialProfileItems(tab, null)
      .then((page) => {
        if (!active) return;
        setItems(page);
        setHasMore(page.length === 20);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    const unsubscribers = [
      onAppEvent("surveyAnswered", ({ surveyId }) =>
        setItems((cur) => cur?.map((i) => (i.kind === "survey" && i.surveyId === surveyId ? { ...i, answered: true } : i)) ?? cur),
      ),
    ];
    return () => {
      active = false;
      unsubscribers.forEach((u) => u());
    };
  }, [tab, reloadKey]);

  function loadMore() {
    const last = items?.[items.length - 1];
    if (!hasMore || loadingMore || last === undefined) return;
    setLoadingMore(true);
    fetchOfficialProfileItems(tab, last.publishedAt)
      .then((page) => {
        setItems((cur) => [...(cur ?? []), ...page.filter((p) => !(cur ?? []).some((c) => c.itemId === p.itemId))]);
        setHasMore(page.length === 20);
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  }

  if (failed) {
    return (
      <ErrorState
        fill
        onRetry={() => {
          setFailed(false);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }
  if (profile === null) return <EmptyState fill icon="person-outline" title="Profil nicht verfügbar" />;

  const header =
    profile === undefined ? (
      <View style={styles.header}>
        <ActivityIndicator color={colors.accent} />
      </View>
    ) : (
      <View style={styles.header}>
        <Avatar uri={avatarUrl} username={profile.username} size={88} />
        <View style={styles.names}>
          <Text style={styles.displayName} accessibilityRole="header">
            {profile.displayName}
          </Text>
          <Text style={styles.handle}>@{profile.username}</Text>
          <OfficialBadge />
        </View>
        {profile.bio !== null && <Text style={styles.bio}>{profile.bio}</Text>}
        <SegmentedControl
          value={tab}
          options={TABS.map((t) => ({ ...t, label: `${t.label} (${t.value === "surveys" ? profile.surveyCount : profile.resultsCount})` }))}
          onChange={(next) => {
            setItems(null);
            setTab(next);
          }}
          accessibilityLabel="Beiträge des offiziellen Kontos"
        />
      </View>
    );

  return (
    <>
      <Stack.Screen options={{ title: profile?.username ?? "" }} />
      <FlatList
        style={styles.screen}
        data={items ?? []}
        keyExtractor={(item) => item.itemId}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <OfficialCard
            item={item}
            onOpen={() =>
              item.kind === "survey"
                ? router.push({ pathname: "/survey/[surveyId]", params: { surveyId: item.surveyId } })
                : router.push({ pathname: "/results/[itemId]", params: { itemId: item.itemId } })
            }
          />
        )}
        ListEmptyComponent={
          items === null ? (
            <ListSkeleton rows={3} avatar={false} />
          ) : (
            <EmptyState
              icon={tab === "surveys" ? "help-circle-outline" : "stats-chart-outline"}
              title={tab === "surveys" ? "Noch keine Umfragen" : "Noch keine Auswertungen"}
              message={tab === "surveys" ? "Neue Umfragen erscheinen hier und oben im Feed." : "Ergebnisse erscheinen hier, sobald sie veröffentlicht sind."}
            />
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={colors.accent} /> : null}
      />
    </>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      alignItems: "center",
      gap: spacing.ms,
      padding: spacing.md,
    },
    names: {
      alignItems: "center",
      gap: spacing.xs,
    },
    displayName: {
      ...typography.heading,
      color: colors.text,
    },
    handle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    bio: {
      ...typography.body,
      color: colors.text,
      textAlign: "center",
    },
    footer: {
      padding: spacing.md,
    },
  }),
);
