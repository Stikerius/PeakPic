import Ionicons from "@expo/vector-icons/Ionicons";
import { Link } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

export function NewChatButton() {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Link href="/chats/new" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Neuer Chat"
        hitSlop={spacing.sm}
        style={styles.button}
      >
        <Ionicons name="create-outline" size={24} color={colors.text} />
      </Pressable>
    </Link>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    button: {
      paddingHorizontal: spacing.md,
    },
  }),
);
