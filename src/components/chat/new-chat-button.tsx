import Ionicons from "@expo/vector-icons/Ionicons";
import { Link } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { colors, spacing } from "@/constants/theme";

export function NewChatButton() {
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

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.md,
  },
});
