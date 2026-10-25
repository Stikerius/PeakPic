import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import { isHovered } from "@/lib/pressState";
import { makeStyles, useTheme } from "@/lib/theme";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "md" | "sm";

type ButtonProps = {
  label: string;
  onPress: () => void;
  /** primary: the one main action of a view. secondary: everything else. ghost: text-only. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentProps<typeof Ionicons>["name"];
  /** Red label for destructive actions (secondary and ghost). */
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const SMALL_HEIGHT = 36;
// Small buttons still get a 44pt touch target.
const SMALL_HIT_SLOP = (44 - SMALL_HEIGHT) / 2;

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  destructive = false,
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isDisabled = disabled || loading;
  const contentColor =
    variant === "primary" ? colors.onAccent : destructive ? colors.danger : variant === "ghost" ? colors.accent : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={size === "sm" ? SMALL_HIT_SLOP : undefined}
      style={(state) => [
        styles.base,
        size === "sm" && styles.small,
        styles[variant],
        isHovered(state) && !disabled && styles.hovered,
        state.pressed && styles.pressed,
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={contentColor} />
      ) : (
        <>
          {icon !== undefined && <Ionicons name={icon} size={size === "sm" ? 16 : 18} color={contentColor} />}
          <Text
            style={[styles.label, size === "sm" && styles.smallLabel, { color: contentColor }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    base: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
    },
    small: {
      minHeight: SMALL_HEIGHT,
      paddingHorizontal: spacing.md,
      gap: spacing.xs,
      borderRadius: radius.sm,
    },
    primary: {
      backgroundColor: colors.accent,
    },
    secondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ghost: {
      backgroundColor: "transparent",
    },
    // Mouse over (web only): slightly darker, like the press feedback but quieter.
    hovered: {
      opacity: 0.88,
    },
    pressed: {
      opacity: 0.75,
      transform: [{ scale: 0.98 }],
    },
    disabled: {
      opacity: 0.4,
    },
    label: {
      ...typography.bodyStrong,
    },
    smallLabel: {
      ...typography.caption,
      fontWeight: "600",
    },
  }),
);
