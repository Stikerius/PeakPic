import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** The label; may contain links (nested pressable text). */
  children: ReactNode;
};

/** Never pre-checked by itself; the label stays tappable for links inside it. */
export function Checkbox({ checked, onChange, disabled = false, accessibilityLabel, children }: CheckboxProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <Pressable
        onPress={() => onChange(!checked)}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={accessibilityLabel}
        hitSlop={spacing.sm}
        style={styles.box}
      >
        <Ionicons
          name={checked ? "checkbox" : "square-outline"}
          size={24}
          color={checked ? colors.accent : colors.textSecondary}
        />
      </Pressable>
      <View style={styles.label}>{children}</View>
    </View>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.ms,
    },
    disabled: {
      opacity: 0.5,
    },
    box: {
      minWidth: 28,
      minHeight: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      flex: 1,
      paddingTop: 3,
    },
  }),
);
