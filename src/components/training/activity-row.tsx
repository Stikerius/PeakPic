import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconButton } from "@/components/plans/exercise-editor";
import { spacing, typography } from "@/constants/theme";
import { formatDate } from "@/lib/format";
import { VISIBILITY_LABELS } from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { WorkoutListItem } from "@/lib/trainingRepo";
import { formatDuration, reasonText, type ActivityVisibility } from "@/lib/workout";

export const VISIBILITY_ICONS: Record<ActivityVisibility, ComponentProps<typeof Ionicons>["name"]> = {
  private: "lock-closed-outline",
  followers: "people-outline",
  public: "globe-outline",
};

type ActivityRowProps = {
  item: WorkoutListItem;
  /** Own activities: the "…" menu (visibility, photo, delete). */
  onMenu?: () => void;
  /** Own activities: show why it doesn't count. */
  showStreakHint?: boolean;
  onPress: () => void;
};

/** One activity: title, date, duration, volume, who sees it and whether it counts for the streak. */
export function ActivityRow({ item, onMenu, showStreakHint = false, onPress }: ActivityRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const details = [formatDate(item.startedAt), formatDuration(item.activeSeconds * 1000)];
  if (item.volumeKg !== null) details.push(`${Math.round(item.volumeKg).toLocaleString("de-CH")} kg`);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${details.join(", ")}, sichtbar für ${VISIBILITY_LABELS[item.visibility]}${
        item.countsForStreak ? ", zählt für den Streak" : ""
      }`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Ionicons
        name={item.countsForStreak ? "flame" : "flame-outline"}
        size={20}
        color={item.countsForStreak ? colors.accent : colors.textTertiary}
      />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.details}>{details.join(" · ")}</Text>
        {showStreakHint && !item.countsForStreak && item.reason !== null && <Text style={styles.hint}>{reasonText(item.reason)}</Text>}
      </View>
      <Ionicons name={VISIBILITY_ICONS[item.visibility]} size={18} color={colors.textSecondary} />
      {onMenu !== undefined && <IconButton icon="ellipsis-horizontal" label={`Aktionen für ${item.title}`} onPress={onMenu} />}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
      paddingVertical: spacing.sm,
    },
    pressed: {
      backgroundColor: colors.surfaceRaised,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typography.body,
      color: colors.text,
    },
    details: {
      ...typography.caption,
      ...typography.numeric,
      color: colors.textSecondary,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
