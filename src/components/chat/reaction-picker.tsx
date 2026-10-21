import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, radius, spacing } from "@/constants/theme";
import { EMOJI_SECTIONS, QUICK_REACTIONS } from "@/lib/emoji";
import { makeStyles, useTheme } from "@/lib/theme";

const BAR_HEIGHT = 56;
const EMOJI_CELL = 44;

type ReactionPickerProps = {
  /** Finger position of the long press; null hides the picker. */
  anchorY: number | null;
  /** My current reaction on the message, highlighted. */
  current: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Someone else's message: offers "Nachricht melden" below the reactions. */
  onReport?: () => void;
};

function EmojiButton({ emoji, selected, onPick }: { emoji: string; selected: boolean; onPick: (emoji: string) => void }) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={() => onPick(emoji)}
      accessibilityRole="button"
      accessibilityLabel={`Mit ${emoji} reagieren`}
      accessibilityState={{ selected }}
      style={[styles.emojiButton, selected && styles.emojiSelected]}
    >
      <Text style={styles.emoji}>{emoji}</Text>
    </Pressable>
  );
}

/**
 * Bar with quick reactions above the pressed message; "…" opens a grid with more emojis.
 * Tapping any emoji reacts right away.
 */
export function ReactionPicker({ anchorY, current, onPick, onClose, onReport }: ReactionPickerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (anchorY === null) setShowAll(false);
  }, [anchorY]);

  const top =
    anchorY === null
      ? 0
      : Math.min(
          Math.max(anchorY - BAR_HEIGHT - spacing.lg, insets.top + spacing.sm),
          height - insets.bottom - BAR_HEIGHT - spacing.xl,
        );

  return (
    <Modal visible={anchorY !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Reaktion abbrechen" />
      {showAll ? (
        <View style={[styles.sheet, { height: height * 0.5, paddingBottom: insets.bottom }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Reaktion wählen</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schliessen" hitSlop={spacing.sm}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {EMOJI_SECTIONS.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.grid}>
                  {section.emojis.map((emoji) => (
                    <EmojiButton key={emoji} emoji={emoji} selected={current === emoji} onPick={onPick} />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={[styles.panel, { top }]} pointerEvents="box-none">
          <View style={styles.bar}>
            {QUICK_REACTIONS.map((emoji) => (
              <EmojiButton key={emoji} emoji={emoji} selected={current === emoji} onPick={onPick} />
            ))}
            <Pressable
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel="Weitere Emojis"
              style={styles.emojiButton}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          </View>
          {onReport !== undefined && (
            <Pressable
              onPress={onReport}
              accessibilityRole="button"
              accessibilityLabel="Nachricht melden"
              style={({ pressed }) => [styles.reportButton, pressed && styles.reportPressed]}
            >
              <Ionicons name="flag-outline" size={18} color={colors.danger} />
              <Text style={styles.reportText}>Nachricht melden</Text>
            </Pressable>
          )}
        </View>
      )}
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.backdrop,
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
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
    emojiButton: {
      width: EMOJI_CELL,
      height: EMOJI_CELL,
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
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "700",
    },
    sheetContent: {
      padding: spacing.sm,
      gap: spacing.md,
    },
    section: {
      gap: spacing.xs,
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "700",
      paddingHorizontal: spacing.xs,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    reportButton: {
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 44,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    reportPressed: {
      opacity: 0.7,
    },
    reportText: {
      color: colors.danger,
      fontSize: fontSize.sm,
      fontWeight: "600",
    },
  }),
);
