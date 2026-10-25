import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * "Offiziell" with a check mark: the official account (cards, its profile, search). With
 * onPress it opens the official profile.
 */
export function OfficialBadge({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const content = (
    <View style={styles.badge}>
      <Ionicons name="checkmark-circle" size={13} color={colors.accent} />
      <Text style={styles.text}>Offiziell</Text>
    </View>
  );
  if (onPress === undefined) return <View accessibilityLabel="Offizielles Konto">{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Offizielles Konto, Profil öffnen"
      hitSlop={spacing.sm}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignSelf: "flex-start",
    },
    text: {
      ...typography.caption,
      fontWeight: "600",
      color: colors.text,
    },
    pressed: {
      opacity: 0.6,
    },
  }),
);
