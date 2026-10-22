import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { ActivityRow } from "@/components/training/activity-row";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useActivityActions } from "@/hooks/use-activity-actions";
import { useSession } from "@/lib/session";
import { makeStyles } from "@/lib/theme";
import { fetchWorkoutsOf, type WorkoutListItem } from "@/lib/trainingRepo";
import { useTrackScreen } from "@/lib/usage";

/** "Aktivitäten": recorded trainings of a person, newest first; others see what the database allows. */
export default function ActivitiesScreen() {
  useTrackScreen("screen_activities");
  const styles = useStyles();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const isMe = useSession().session?.user.id === userId;
  const [items, setItems] = useState<WorkoutListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let active = true;
    fetchWorkoutsOf(userId)
      .then((result) => {
        if (!active) return;
        setFailed(false);
        setItems(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useFocusEffect(load);
  const actions = useActivityActions(() => void load());

  if (items === null) {
    return <View style={styles.screen}>{failed ? <ErrorState onRetry={load} fill /> : <ListSkeleton />}</View>;
  }

  return (
    <FlatList
      style={styles.screen}
      data={items}
      keyExtractor={(item) => item.id}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        <EmptyState
          icon="barbell-outline"
          title="Noch keine Aktivitäten"
          message={isMe ? "Aufgezeichnete Trainings erscheinen hier, auch ohne Foto." : "Hier gibt es nichts, was du sehen kannst."}
          action={isMe ? { label: "Training starten", onPress: () => router.navigate("/training") } : undefined}
          fill
        />
      }
      renderItem={({ item }) => (
        <ActivityRow
          item={item}
          showStreakHint={isMe}
          onMenu={isMe ? () => actions.openMenu(item) : undefined}
          onPress={() => router.push({ pathname: "/workout/[id]", params: { id: item.id } })}
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
