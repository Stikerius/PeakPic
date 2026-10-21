import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type EmptyStateProps = {
  icon?: ComponentProps<typeof Ionicons>["name"];
  title: string;
  message?: string;
  /** One clear next step. */
  action?: { label: string; onPress: () => void };
  /** Fill the available space and center (whole-screen states). */
  fill?: boolean;
};

/** Empty or error state: short, factual text and at most one action. */
export function EmptyState({ icon, title, message, action, fill = false }: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.container, fill && styles.fill]}>
      {icon !== undefined && <Ionicons name={icon} size={32} color={colors.textTertiary} />}
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {message !== undefined && <Text style={styles.message}>{message}</Text>}
      </View>
      {action !== undefined && (
        <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" style={styles.action} />
      )}
    </View>
  );
}

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
  fill?: boolean;
};

/** Loading failed. Explains it plainly and offers a retry when possible. */
export function ErrorState({ message = "Bitte prüfe deine Verbindung.", onRetry, fill }: ErrorStateProps) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Konnte nicht geladen werden"
      message={message}
      action={onRetry !== undefined ? { label: "Erneut versuchen", onPress: onRetry } : undefined}
      fill={fill}
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl,
    },
    fill: {
      flex: 1,
      justifyContent: "center",
    },
    text: {
      alignItems: "center",
      gap: spacing.xs,
      maxWidth: 320,
    },
    title: {
      ...typography.bodyStrong,
      color: colors.text,
      textAlign: "center",
    },
    message: {
      ...typography.caption,
      color: colors.textSecondary,
      textAlign: "center",
    },
    action: {
      marginTop: spacing.xs,
    },
  }),
);
