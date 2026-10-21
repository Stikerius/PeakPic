import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { fontSize, radius, spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "md" | "sm";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === "sm" && styles.small,
        variant === "primary" ? styles.primary : styles.secondary,
        (pressed || isDisabled) && styles.dimmed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.label, variant === "primary" && styles.primaryLabel, size === "sm" && styles.smallLabel]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    base: {
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    small: {
      minHeight: 34,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
    },
    primary: {
      backgroundColor: colors.accent,
    },
    secondary: {
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dimmed: {
      opacity: 0.6,
    },
    label: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
    primaryLabel: {
      color: colors.onAccent,
    },
    smallLabel: {
      fontSize: fontSize.sm,
    },
  }),
);
