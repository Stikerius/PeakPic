import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
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

import { Button } from "@/components/button";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import type { CapturedPhoto } from "@/types/photo";

const CAPTION_MAX_LENGTH = 200;

type PhotoReviewProps = {
  photo: CapturedPhoto;
  saving: boolean;
  error: string | null;
  onRetake: () => void;
  onCancel: () => void;
  onUse: (caption: string) => void;
};

export function PhotoReview({
  photo,
  saving,
  error,
  onRetake,
  onCancel,
  onUse,
}: PhotoReviewProps) {
  const [caption, setCaption] = useState("");
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + spacing.md }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abbrechen und Kamera verlassen"
          onPress={onCancel}
          disabled={saving}
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
          <Text style={styles.cancelLabel}>Abbrechen</Text>
        </Pressable>
      </View>
      <Image
        source={{ uri: photo.uri }}
        style={styles.image}
        contentFit="contain"
        accessibilityLabel="Vorschau des aufgenommenen Fotos"
      />
      <View style={styles.controls}>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Caption hinzufügen (optional)"
          placeholderTextColor={colors.textMuted}
          maxLength={CAPTION_MAX_LENGTH}
          style={styles.input}
          editable={!saving}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
        />
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          <Button
            label={photo.source === "camera" ? "Wiederholen" : "Verwerfen"}
            variant="secondary"
            onPress={onRetake}
            disabled={saving}
            style={styles.action}
          />
          <Button
            label="Verwenden"
            onPress={() => onUse(caption)}
            loading={saving}
            style={styles.action}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  cancel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  cancelLabel: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  image: {
    flex: 1,
  },
  controls: {
    gap: spacing.md,
    padding: spacing.md,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  action: {
    flex: 1,
  },
});
