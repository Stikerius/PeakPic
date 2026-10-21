import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { contrastColor } from "@/components/media-editor/overlay";
import { TaggedTextInput } from "@/components/tagged-text-input";
import { fontSize, onPhoto, photoTextColors, radius, spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

export const TEXT_COLORS = photoTextColors;

const MAX_LENGTH = 60;

export type TextOverlayValue = { text: string; color: string; background: boolean };

type TextOverlayEditorProps = {
  initial: TextOverlayValue;
  /** Called with the new value, or with empty text to remove the overlay. */
  onDone: (value: TextOverlayValue) => void;
};

/** Full-screen text input with colour and background options, like Instagram's text tool. */
export function TextOverlayEditor({ initial, onDone }: TextOverlayEditorProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(initial);

  return (
    <KeyboardAvoidingView
      style={styles.backdrop}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => setValue((v) => ({ ...v, background: !v.background }))}
          accessibilityRole="switch"
          accessibilityLabel="Hintergrund hinter dem Text"
          accessibilityState={{ checked: value.background }}
          style={[styles.toolButton, value.background && styles.toolButtonActive]}
        >
          <Ionicons name="text" size={20} color={value.background ? colors.background : colors.text} />
        </Pressable>
        <Pressable onPress={() => onDone(value)} accessibilityRole="button" hitSlop={spacing.sm}>
          <Text style={styles.done}>Fertig</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <TaggedTextInput
          value={value.text}
          onChangeText={(text) => setValue((v) => ({ ...v, text }))}
          suggestionsPlacement="below"
          tone="dark"
          containerStyle={styles.inputBox}
          autoFocus
          maxLength={MAX_LENGTH}
          placeholder="Text eingeben…"
          placeholderTextColor={onPhoto.textTertiary}
          textAlign="center"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => onDone(value)}
          accessibilityLabel="Story-Text"
          style={[
            styles.input,
            { color: value.color },
            value.background && { backgroundColor: value.color, color: contrastColor(value.color) },
          ]}
        />
      </View>

      <View style={styles.swatches}>
        {TEXT_COLORS.map((color) => (
          <Pressable
            key={color}
            onPress={() => setValue((v) => ({ ...v, color }))}
            accessibilityRole="button"
            accessibilityLabel={`Farbe ${color}`}
            accessibilityState={{ selected: value.color === color }}
            style={[styles.swatch, { backgroundColor: color }, value.color === color && styles.swatchSelected]}
          />
        ))}
      </View>
    </KeyboardAvoidingView>
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
      backgroundColor: onPhoto.scrimStrong,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
    },
    toolButton: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: colors.text,
    },
    toolButtonActive: {
      backgroundColor: colors.text,
    },
    done: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
    center: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    inputBox: {
      alignSelf: "stretch",
      paddingHorizontal: spacing.lg,
    },
    input: {
      alignSelf: "center",
      minWidth: 120,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      fontSize: 30,
      fontWeight: "700",
    },
    swatches: {
      flexDirection: "row",
      justifyContent: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    swatch: {
      width: 30,
      height: 30,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: onPhoto.outline,
    },
    swatchSelected: {
      borderWidth: 3,
      borderColor: colors.text,
      transform: [{ scale: 1.15 }],
    },
  }),
);
