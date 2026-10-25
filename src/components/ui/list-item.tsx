import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { spacing, typography } from "@/constants/theme";
import { isHovered } from "@/lib/pressState";
import { makeStyles, useTheme } from "@/lib/theme";

type ListItemProps = {
  title: string;
  subtitle?: string;
  /** Outline icon on the left (same family and size for every row). */
  icon?: ComponentProps<typeof Ionicons>["name"];
  /** Anything else on the left, e.g. an avatar. Takes precedence over `icon`. */
  leading?: ReactNode;
  /** Right side: a switch, a value, a button … */
  trailing?: ReactNode;
  /** Shows a chevron (navigates somewhere). */
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/** Left inset of a divider under a row with an icon, so it lines up with the title. */
export const LIST_ICON_INSET = spacing.md + 24 + spacing.ms;

/** One row of a list or settings section. Separate rows with <Divider />. */
export function ListItem({
  title,
  subtitle,
  icon,
  leading,
  trailing,
  chevron = false,
  destructive = false,
  disabled = false,
  onPress,
  accessibilityLabel,
}: ListItemProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const left =
    leading ??
    (icon !== undefined ? (
      <Ionicons name={icon} size={22} color={destructive ? colors.danger : colors.textSecondary} style={styles.icon} />
    ) : null);

  const content = (
    <>
      {left}
      <View style={styles.text}>
        <Text style={[styles.title, destructive && styles.destructive]}>{title}</Text>
        {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {trailing}
      {chevron && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
    </>
  );

  if (onPress === undefined) {
    return <View style={[styles.row, disabled && styles.disabled]}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle !== undefined ? `${title}, ${subtitle}` : title)}
      accessibilityState={{ disabled }}
      style={(state) => [styles.row, (state.pressed || (isHovered(state) && !disabled)) && styles.pressed, disabled && styles.disabled]}
    >
      {content}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
      backgroundColor: colors.surface,
    },
    pressed: {
      backgroundColor: colors.surfaceRaised,
    },
    disabled: {
      opacity: 0.45,
    },
    icon: {
      width: 24,
      textAlign: "center",
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typography.body,
      color: colors.text,
    },
    destructive: {
      color: colors.danger,
    },
    subtitle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
