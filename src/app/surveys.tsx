import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { LIST_ICON_INSET, ListItem } from "@/components/ui/list-item";
import { SectionHeader } from "@/components/ui/section-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { radius, spacing, typography } from "@/constants/theme";
import { onAppEvent } from "@/lib/events";
import { surveyRowSubtitle } from "@/lib/surveyFeed";
import { fetchActiveSurveys, trackSurveyEvent, type ActiveSurveys } from "@/lib/surveyRepo";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * Settings, "Umfragen": every running survey (open or answered, also ones hidden in the feed)
 * and results of the last 30 days.
 */
export default function SurveysScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [data, setData] = useState<ActiveSurveys | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    return fetchActiveSurveys()
      .then((result) => {
        setData(result);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    trackSurveyEvent(null, "settings_list_opened");
    let active = true;
    fetchActiveSurveys()
      .then((result) => {
        if (!active) return;
        setData(result);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    const unsubscribe = onAppEvent("surveyAnswered", () => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  if (failed && data === null) return <ErrorState fill onRetry={() => void load()} />;
  if (data === null) {
    return (
      <View style={styles.screen}>
        <ListSkeleton rows={4} avatar={false} />
      </View>
    );
  }
  const now = new Date();
  if (data.surveys.length === 0 && data.results.length === 0) {
    return <EmptyState fill icon="stats-chart-outline" title="Gerade läuft keine Umfrage" message="Neue Umfragen erscheinen oben im Feed und hier." />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
          tintColor={colors.accent}
        />
      }
    >
      {data.surveys.length > 0 && (
        <>
          <SectionHeader title="Laufende Umfragen" />
          <View style={styles.card}>
            {data.surveys.map((item, i) => (
              <View key={item.itemId}>
                {i > 0 && <Divider inset={LIST_ICON_INSET} />}
                <ListItem
                  icon={item.answered ? "checkmark-circle-outline" : "help-circle-outline"}
                  title={item.title}
                  subtitle={surveyRowSubtitle(item, now)}
                  chevron
                  onPress={() => router.push({ pathname: "/survey/[surveyId]", params: { surveyId: item.surveyId } })}
                />
              </View>
            ))}
          </View>
        </>
      )}
      {data.results.length > 0 && (
        <>
          <SectionHeader title="Auswertungen" />
          <View style={styles.card}>
            {data.results.map((item, i) => (
              <View key={item.itemId}>
                {i > 0 && <Divider inset={LIST_ICON_INSET} />}
                <ListItem
                  icon="stats-chart-outline"
                  title={item.title}
                  subtitle={`${item.snapshot?.participants ?? 0} Teilnahmen`}
                  chevron
                  onPress={() => router.push({ pathname: "/results/[itemId]", params: { itemId: item.itemId } })}
                />
              </View>
            ))}
          </View>
        </>
      )}
      <Text style={styles.footnote}>Deine Antworten werden ohne Bezug zu deinem Konto gespeichert.</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    card: {
      marginHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    footnote: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
    },
  }),
);
