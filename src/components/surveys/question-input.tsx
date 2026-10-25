import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { SurveyQuestion } from "../../../shared/surveys";
import { TextField } from "@/components/ui/text-field";
import { radius, spacing, typography } from "@/constants/theme";
import { toggleChoice } from "@/lib/surveyFlow";
import { makeStyles, useTheme } from "@/lib/theme";

type QuestionInputProps = {
  question: SurveyQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
};

function Option({ label, selected, multiple, onPress }: { label: string; selected: boolean; multiple: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const icon = multiple ? (selected ? "checkbox" : "square-outline") : selected ? "radio-button-on" : "radio-button-off";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityState={multiple ? { checked: selected } : { selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={selected ? colors.accent : colors.textSecondary} />
      <Text style={styles.optionText}>{label}</Text>
    </Pressable>
  );
}

/** The input of one question: options, scale, yes/no or free text (with the character limit). */
export function QuestionInput({ question, value, onChange }: QuestionInputProps) {
  const styles = useStyles();

  if (question.kind === "single" || question.kind === "multiple") {
    const multiple = question.kind === "multiple";
    const selected = multiple ? (Array.isArray(value) ? value : []) : [value];
    return (
      <View style={styles.list} accessibilityRole={multiple ? undefined : "radiogroup"}>
        {multiple && (question.maxChoices ?? 1) < (question.options?.length ?? 0) && (
          <Text style={styles.hint}>Bis zu {question.maxChoices} Antworten</Text>
        )}
        {(question.options ?? []).map((label, index) => (
          <Option
            key={index}
            label={label}
            multiple={multiple}
            selected={selected.includes(index)}
            onPress={() => onChange(multiple ? toggleChoice(question, value, index) : index)}
          />
        ))}
      </View>
    );
  }

  if (question.kind === "yes_no") {
    return (
      <View style={styles.list} accessibilityRole="radiogroup">
        <Option label="Ja" multiple={false} selected={value === true} onPress={() => onChange(true)} />
        <Option label="Nein" multiple={false} selected={value === false} onPress={() => onChange(false)} />
      </View>
    );
  }

  if (question.kind === "scale") {
    const min = question.scaleMin ?? 1;
    const max = question.scaleMax ?? 5;
    const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <View style={styles.list}>
        <View style={styles.scale} accessibilityRole="radiogroup" accessibilityLabel={`Skala von ${min} bis ${max}`}>
          {values.map((n) => {
            const selected = value === n;
            return (
              <Pressable
                key={n}
                onPress={() => onChange(n)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${n}`}
                style={({ pressed }) => [styles.scaleItem, selected && styles.scaleSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.scaleText, selected && styles.scaleTextSelected]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.scaleEnds}>
          <Text style={styles.hint}>{min} = am wenigsten</Text>
          <Text style={styles.hint}>{max} = am meisten</Text>
        </View>
      </View>
    );
  }

  const textValue = typeof value === "string" ? value : "";
  const max = question.textMax ?? 280;
  return (
    <TextField
      label="Deine Antwort"
      hint={`${[...textValue].length} von ${max} Zeichen. Schreib nichts, woran man dich erkennen kann.`}
      value={textValue}
      onChangeText={(t) => onChange([...t].slice(0, max).join(""))}
      multiline
      maxLength={max}
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    list: {
      gap: spacing.sm,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    optionSelected: {
      backgroundColor: colors.accentSoft,
    },
    pressed: {
      opacity: 0.7,
    },
    optionText: {
      ...typography.body,
      color: colors.text,
      flex: 1,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    scale: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    scaleItem: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    scaleSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    scaleText: {
      ...typography.bodyStrong,
      ...typography.numeric,
      color: colors.text,
    },
    scaleTextSelected: {
      color: colors.onAccent,
    },
    scaleEnds: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
  }),
);
