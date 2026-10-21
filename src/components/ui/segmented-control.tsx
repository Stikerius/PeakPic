import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";

type SegmentedControlProps<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  accessibilityLabel: string;
};

/** iOS-style segmented choice; the selected segment is lifted, not coloured. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const styles = useStyles();
  return (
    <View
      style={[styles.track, disabled && styles.disabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const TRACK_PADDING = 2;

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      padding: TRACK_PADDING,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
    },
    disabled: {
      opacity: 0.45,
    },
    segment: {
      flex: 1,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm - TRACK_PADDING,
    },
    selected: {
      backgroundColor: colors.controlActive,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    label: {
      ...typography.caption,
      fontWeight: "500",
      color: colors.textSecondary,
    },
    labelSelected: {
      color: colors.text,
      fontWeight: "600",
    },
  }),
);
