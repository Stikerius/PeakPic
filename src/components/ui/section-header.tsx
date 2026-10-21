import { Pressable, StyleSheet, Text, View } from "react-native";

import { spacing, typography } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";

type SectionHeaderProps = {
  title: string;
  /** Optional text action on the right, e.g. "Alle anzeigen". */
  action?: { label: string; onPress: () => void };
};

/** Quiet title above a group of rows. Sentence case, never uppercase. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  const styles = useStyles();
  return (
    <View style={styles.header} accessibilityRole="header">
      <Text style={styles.title}>{title}</Text>
      {action !== undefined && (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={spacing.ms}>
          <Text style={styles.action}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Explanation below a group of rows. */
export function SectionFooter({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.footer}>{children}</Text>;
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    title: {
      ...typography.caption,
      fontWeight: "500",
      color: colors.textSecondary,
    },
    action: {
      ...typography.caption,
      fontWeight: "500",
      color: colors.accent,
    },
    footer: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  }),
);
