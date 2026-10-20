import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { contrastColor } from "@/components/media-editor/overlay";
import { colors, fontSize, radius, spacing } from "@/constants/theme";

export const TEXT_COLORS = [
  "#FFFFFF",
  "#000000",
  colors.primary,
  "#FFD60A",
  "#34C759",
  "#0A84FF",
  "#FF375F",
] as const;

const MAX_LENGTH = 60;

export type TextOverlayValue = { text: string; color: string; background: boolean };

type TextOverlayEditorProps = {
  initial: TextOverlayValue;
  /** Called with the new value, or with empty text to remove the overlay. */
  onDone: (value: TextOverlayValue) => void;
};

/** Full-screen text input with colour and background options, like Instagram's text tool. */
export function TextOverlayEditor({ initial, onDone }: TextOverlayEditorProps) {
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
        <TextInput
          value={value.text}
          onChangeText={(text) => setValue((v) => ({ ...v, text }))}
          autoFocus
          maxLength={MAX_LENGTH}
          placeholder="Text eingeben…"
          placeholderTextColor="rgba(255, 255, 255, 0.6)"
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

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
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
    borderColor: "rgba(255, 255, 255, 0.6)",
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: colors.text,
    transform: [{ scale: 1.15 }],
  },
});
