import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { OfficialItem } from "../../../shared/surveys";
import { OfficialBadge } from "@/components/surveys/official-badge";
import { ResultsQuestion, percentText } from "@/components/surveys/results-question";
import { SurveyMediaRow } from "@/components/surveys/survey-media";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { spacing, typography } from "@/constants/theme";
import { formatDate } from "@/lib/format";
import { useOfficialAccountId } from "@/lib/officialAccount";
import { fetchOfficialItem, trackSurveyEvent } from "@/lib/surveyRepo";
import { makeStyles } from "@/lib/theme";
import { track } from "@/lib/usage";

/**
 * A published results summary: exactly the numbers and texts of its fixed snapshot (never
 * computed live), with the conclusion, images or logos, and per question bars or a table.
 */
export default function ResultsScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const styles = useStyles();
  const officialId = useOfficialAccountId();
  const [item, setItem] = useState<OfficialItem | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchOfficialItem(itemId)
      .then((result) => {
        if (!active) return;
        setItem(result);
        setFailed(false);
        if (result !== null) {
          track("results_opened");
          trackSurveyEvent(result.surveyId, "results_opened");
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [itemId, reloadKey]);

  if (failed) return <ErrorState fill onRetry={() => setReloadKey((k) => k + 1)} />;
  if (item === undefined) {
    return (
      <View style={styles.content} accessibilityLabel="Wird geladen" accessibilityRole="progressbar">
        <Skeleton width="70%" height={28} />
        <Skeleton height={60} />
        <Skeleton height={120} />
      </View>
    );
  }
  const snapshot = item?.snapshot ?? null;
  if (item === null || snapshot === null) {
    return <EmptyState fill icon="document-text-outline" title="Nicht mehr verfügbar" message="Diese Auswertung wurde zurückgezogen oder ist abgelaufen." />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <OfficialBadge onPress={typeof officialId === "string" ? () => router.push({ pathname: "/user/[userId]", params: { userId: officialId } }) : undefined} />
      <Text style={styles.title} accessibilityRole="header">
        {snapshot.title}
      </Text>
      <Text style={styles.meta}>
        {snapshot.participants} Teilnahmen
        {snapshot.participationRate !== null ? ` · Teilnahmequote ${percentText(snapshot.participationRate * 100)}` : ""}
        {snapshot.closedAt !== null ? ` · beendet am ${formatDate(snapshot.closedAt)}` : ""}
      </Text>
      <View style={styles.conclusion}>
        <Text style={styles.label}>Fazit</Text>
        <Text style={styles.body}>{snapshot.conclusion}</Text>
      </View>
      <SurveyMediaRow media={snapshot.media} />
      {snapshot.questions.map((q, i) => (
        <ResultsQuestion key={i} question={q} index={i} />
      ))}
      <Text style={styles.meta}>Die Zahlen stammen aus der veröffentlichten Zusammenfassung und ändern sich nicht mehr. Einzelne Antworten sind nicht einsehbar.</Text>
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
      padding: spacing.md,
      gap: spacing.md,
      backgroundColor: colors.background,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    conclusion: {
      gap: spacing.xs,
    },
    label: {
      ...typography.label,
      color: colors.textSecondary,
    },
    body: {
      ...typography.body,
      color: colors.text,
    },
  }),
);
