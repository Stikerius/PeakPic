import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { SectionFooter } from "@/components/ui/section-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import {
  REPORT_REASONS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_LABELS,
  listMyReports,
  type MyReport,
} from "@/lib/reportRepo";
import { makeStyles } from "@/lib/theme";
import { useTrackScreen } from "@/lib/usage";

function reasonLabel(report: MyReport): string {
  return REPORT_REASONS.find((r) => r.value === report.reason)?.label ?? report.reason;
}

export default function MyReportsScreen() {
  useTrackScreen("screen_my_reports");
  const styles = useStyles();
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let active = true;
    listMyReports()
      .then((result) => {
        if (!active) return;
        setReports(result);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  if (reports === null) {
    return (
      <View style={styles.screen}>
        {failed ? (
          <ErrorState
            fill
            onRetry={() => {
              setFailed(false);
              load();
            }}
          />
        ) : (
          <ListSkeleton rows={4} avatar={false} />
        )}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={reports}
      keyExtractor={(report) => report.id}
      ItemSeparatorComponent={() => <Divider inset={16} />}
      ListEmptyComponent={
        <EmptyState
          icon="flag-outline"
          title="Keine Meldungen"
          message="Melden kannst du über das Menü an Beiträgen, Storys, Kommentaren, Nachrichten und Profilen."
        />
      }
      ListFooterComponent={
        reports.length > 0 ? (
          <SectionFooter>
            Aus Rücksicht auf alle Beteiligten zeigen wir nur den Stand deiner Meldung, nicht die Entscheidung im
            Einzelnen.
          </SectionFooter>
        ) : null
      }
      renderItem={({ item }) => (
        <ListItem
          title={`${REPORT_TARGET_LABELS[item.targetType]} · ${reasonLabel(item)}`}
          subtitle={`Gemeldet am ${formatDate(item.createdAt)}`}
          trailing={<Badge value={REPORT_STATUS_LABELS[item.status]} tone={item.status === "open" ? "accent" : "neutral"} />}
        />
      )}
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
  }),
);
