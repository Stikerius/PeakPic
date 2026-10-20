import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { QUICK_REACTIONS, isSingleEmoji } from "@/lib/emoji";

const BAR_HEIGHT = 56;

type ReactionPickerProps = {
  /** Finger position of the long press; null hides the picker. */
  anchorY: number | null;
  /** My current reaction on the message, highlighted in the bar. */
  current: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
};

/** Bar with quick reactions and "…" for any single emoji, shown above the pressed message. */
export function ReactionPicker({ anchorY, current, onPick, onClose }: ReactionPickerProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [custom, setCustom] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (anchorY === null) {
      setCustom(null);
      setError(false);
    }
  }, [anchorY]);

  function changeCustom(text: string) {
    setCustom(text);
    if (isSingleEmoji(text)) {
      onPick(text.trim());
    } else {
      setError(text.trim().length > 0);
    }
  }

  const top =
    anchorY === null
      ? 0
      : Math.min(Math.max(anchorY - BAR_HEIGHT - spacing.lg, insets.top + spacing.sm), height / 2);

  return (
    <Modal visible={anchorY !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Reaktion abbrechen" />
      <View style={[styles.panel, { top }]} pointerEvents="box-none">
        {custom === null ? (
          <View style={styles.bar}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onPick(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`Mit ${emoji} reagieren`}
                accessibilityState={{ selected: current === emoji }}
                style={[styles.emojiButton, current === emoji && styles.emojiSelected]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setCustom("")}
              accessibilityRole="button"
              accessibilityLabel="Anderes Emoji wählen"
              style={styles.emojiButton}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.customBox}>
            <TextInput
              value={custom}
              onChangeText={changeCustom}
              autoFocus
              placeholder="Ein Emoji eingeben"
              placeholderTextColor={colors.textMuted}
              style={styles.customInput}
              accessibilityLabel="Eigenes Emoji"
            />
            <Text style={[styles.customHint, error && styles.customError]}>
              {error ? "Bitte genau ein Emoji eingeben." : "Tipp: Emoji-Tastatur über 🌐 bzw. 😀 öffnen."}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  panel: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    alignItems: "center",
  },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emojiButton: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiSelected: {
    backgroundColor: colors.border,
  },
  emoji: {
    fontSize: 26,
  },
  customBox: {
    width: "100%",
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 28,
    textAlign: "center",
  },
  customHint: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
  customError: {
    color: colors.danger,
  },
});
