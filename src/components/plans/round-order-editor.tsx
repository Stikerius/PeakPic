import { StyleSheet, Text, View } from "react-native";

import { IconButton } from "@/components/plans/exercise-editor";
import { DraggableList } from "@/components/ui/draggable-list";
import { spacing, typography } from "@/constants/theme";
import { moveLabel, moveTo } from "@/lib/sortable";
import { makeStyles } from "@/lib/theme";

export type RoundUnit = { id: string; title: string; type: "training" | "rest" };

type RoundOrderEditorProps = {
  /** The open units in their order. */
  units: RoundUnit[];
  onChange: (ids: string[]) => void;
  onDragChange?: (dragging: boolean) => void;
  disabled?: boolean;
  /** The first unit is the one due next ("Als Nächstes"). */
  firstIsNext?: boolean;
  /** "…" per unit (e.g. skip it). */
  onMore?: (unit: RoundUnit) => void;
};

/** Open units of the current round, reorderable by dragging or with the arrows (VoiceOver). */
export function RoundOrderEditor({
  units,
  onChange,
  onDragChange,
  disabled = false,
  firstIsNext = false,
  onMore,
}: RoundOrderEditorProps) {
  const styles = useStyles();
  const ids = units.map((u) => u.id);
  const move = (from: number, to: number) => onChange(moveTo(ids, from, to));
  return (
    <View style={styles.group}>
      <DraggableList
        items={units}
        keyOf={(unit) => unit.id}
        onMove={move}
        onDragChange={onDragChange}
        renderItem={(unit, index, handle) => (
          <View style={[styles.row, index > 0 && styles.divider]}>
            {units.length > 1 && !disabled ? handle : <View style={styles.handleSpace} />}
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {index + 1}. {unit.title}
              </Text>
              {(unit.type === "rest" || (firstIsNext && index === 0)) && (
                <Text style={styles.meta}>
                  {[firstIsNext && index === 0 ? "Als Nächstes" : null, unit.type === "rest" ? "Ruhetag" : null]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </Text>
              )}
            </View>
            <IconButton
              icon="chevron-up"
              label={moveLabel(unit.title, index, units.length, "up")}
              onPress={() => move(index, index - 1)}
              disabled={disabled || index === 0}
            />
            <IconButton
              icon="chevron-down"
              label={moveLabel(unit.title, index, units.length, "down")}
              onPress={() => move(index, index + 1)}
              disabled={disabled || index === units.length - 1}
            />
            {onMore !== undefined && (
              <IconButton
                icon="ellipsis-horizontal"
                label={`${unit.title}: überspringen`}
                onPress={() => onMore(unit)}
                disabled={disabled}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    group: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    row: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingRight: spacing.xs,
      backgroundColor: colors.surface,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    handleSpace: {
      width: spacing.md,
    },
    text: {
      flex: 1,
    },
    title: {
      ...typography.body,
      color: colors.text,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
