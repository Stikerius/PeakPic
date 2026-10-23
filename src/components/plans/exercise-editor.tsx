import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ComponentProps, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { TextField } from "@/components/ui/text-field";
import { radius, spacing, typography } from "@/constants/theme";
import { EXERCISE_NAME_MAX_LENGTH, EXERCISE_NOTES_MAX_LENGTH, suggestNames, type ExerciseDraft } from "@/lib/planDraft";
import { makeStyles, useTheme } from "@/lib/theme";
import { moveLabel } from "@/lib/sortable";

type IconName = ComponentProps<typeof Ionicons>["name"];

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.textSecondary} />
    </Pressable>
  );
}

type ExerciseEditorProps = {
  exercise: ExerciseDraft;
  label: string;
  /** Earlier exercise names for suggestions. */
  knownNames: readonly string[];
  isFirst: boolean;
  isLast: boolean;
  onChange: (change: Partial<ExerciseDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  /** Position in the day, for the arrow labels ("Kniebeuge, Position 2 von 4, …"). */
  position?: { index: number; total: number };
  /** Drag handle (from DraggableList). */
  handle?: ReactElement;
};

/** One planned exercise: name (with suggestions), sets, reps or time, optional weight and notes. */
export function ExerciseEditor({
  exercise,
  label,
  knownNames,
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
  position,
  handle,
}: ExerciseEditorProps) {
  const styles = useStyles();
  const [nameFocused, setNameFocused] = useState(false);
  const suggestions = nameFocused ? suggestNames(exercise.name, knownNames, 4) : [];
  const [showNotes, setShowNotes] = useState(exercise.notes !== "");

  const spoken = exercise.name.trim() !== "" ? exercise.name.trim() : label;
  const upLabel = position !== undefined ? moveLabel(spoken, position.index, position.total, "up") : `${label} nach oben`;
  const downLabel = position !== undefined ? moveLabel(spoken, position.index, position.total, "down") : `${label} nach unten`;

  return (
    <View style={styles.exercise}>
      <View style={styles.header}>
        {handle}
        <Text style={[styles.label, styles.labelGrow]}>{label}</Text>
        <View style={styles.actions}>
          <IconButton icon="chevron-up" label={upLabel} onPress={() => onMove(-1)} disabled={isFirst} />
          <IconButton icon="chevron-down" label={downLabel} onPress={() => onMove(1)} disabled={isLast} />
          <IconButton icon="trash-outline" label={`${label} entfernen`} onPress={onRemove} destructive />
        </View>
      </View>
      <TextField
        label="Übung"
        value={exercise.name}
        onChangeText={(name) => onChange({ name })}
        onFocus={() => setNameFocused(true)}
        onBlur={() => setNameFocused(false)}
        placeholder="z.B. Bankdrücken"
        maxLength={EXERCISE_NAME_MAX_LENGTH}
        autoCapitalize="sentences"
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestions} accessibilityLabel="Vorschläge">
          {suggestions.map((name) => (
            <Pressable
              key={name}
              onPress={() => onChange({ name })}
              accessibilityRole="button"
              accessibilityLabel={`Vorschlag ${name}`}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
            >
              <Text style={styles.suggestionText} numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.row}>
        <View style={styles.cellSmall}>
          <TextField label="Sätze" value={exercise.sets} onChangeText={(sets) => onChange({ sets })} keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={styles.cell}>
          <TextField
            label="Wdh."
            hint="z.B. 8 oder 8-12"
            value={exercise.reps}
            onChangeText={(reps) => onChange({ reps })}
            keyboardType="numbers-and-punctuation"
            maxLength={7}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <TextField
            label="Zeit (optional)"
            hint="mm:ss"
            value={exercise.time}
            onChangeText={(time) => onChange({ time })}
            keyboardType="numbers-and-punctuation"
            placeholder="0:45"
            maxLength={5}
          />
        </View>
        <View style={styles.cell}>
          <TextField
            label="Zielgewicht (optional)"
            hint="kg"
            value={exercise.weight}
            onChangeText={(weight) => onChange({ weight })}
            keyboardType="decimal-pad"
            maxLength={7}
          />
        </View>
      </View>
      {showNotes ? (
        <TextField
          label="Notiz (optional)"
          value={exercise.notes}
          onChangeText={(notes) => onChange({ notes })}
          maxLength={EXERCISE_NOTES_MAX_LENGTH}
          multiline
        />
      ) : (
        <Pressable onPress={() => setShowNotes(true)} accessibilityRole="button" style={styles.addNote}>
          <Text style={styles.addNoteText}>Notiz hinzufügen</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    exercise: {
      gap: spacing.sm,
      padding: spacing.ms,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    labelGrow: {
      flex: 1,
    },
    label: {
      ...typography.label,
      color: colors.textSecondary,
    },
    actions: {
      flexDirection: "row",
      marginRight: -spacing.sm,
    },
    row: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    cell: {
      flex: 1,
    },
    cellSmall: {
      width: 88,
    },
    suggestions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    suggestion: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    suggestionText: {
      ...typography.caption,
      color: colors.text,
    },
    addNote: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    addNoteText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.6,
    },
    disabled: {
      opacity: 0.3,
    },
  }),
);
