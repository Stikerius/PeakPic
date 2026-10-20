import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";
import type { CapturedPhoto } from "@/types/photo";

const CAPTION_MAX_LENGTH = 200;

type PhotoReviewProps = {
  photo: CapturedPhoto;
  saving: boolean;
  error: string | null;
  /** Discards the photo and returns to the live camera (button or swipe down). */
  onRetake: () => void;
  onUse: (caption: string) => void;
};

export function PhotoReview({
  photo,
  saving,
  error,
  onRetake,
  onUse,
}: PhotoReviewProps) {
  const [caption, setCaption] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const insets = useSafeAreaInsets();
  const swipeDown = useSwipeToDismiss({ onDismiss: onRetake, enabled: !saving, fadeTo: 0.4 });

  const tapImage = Gesture.Tap()
    .runOnJS(true)
    .onStart(() => setFullscreen(true));

  const imageGesture = Gesture.Race(swipeDown.gesture, tapImage);

  return (
    <View style={styles.backdrop}>
      <Animated.View style={[styles.flex, swipeDown.animatedStyle]}>
        <KeyboardAvoidingView
          style={[styles.container, { paddingTop: insets.top + spacing.sm }]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.grabberArea}>
            <View style={styles.grabber} />
            <Text style={styles.hint}>Nach unten ziehen zum Verwerfen · Tippen für Vollbild</Text>
          </View>

          <GestureDetector gesture={imageGesture}>
            <View
              style={styles.flex}
              collapsable={false}
              accessible
              accessibilityRole="imagebutton"
              accessibilityLabel="Vorschau des aufgenommenen Fotos"
              accessibilityHint="Tippen für Vollbild, nach unten ziehen zum Verwerfen"
            >
              <Image source={{ uri: photo.uri }} style={styles.flex} contentFit="contain" />
            </View>
          </GestureDetector>

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
      </Animated.View>

      <Modal
        visible={fullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setFullscreen(false)}
      >
        <StatusBar hidden />
        <Pressable
          style={styles.fullscreen}
          onPress={() => setFullscreen(false)}
          accessibilityRole="button"
          accessibilityLabel="Vollbild schliessen"
        >
          <Image source={{ uri: photo.uri }} style={styles.flex} contentFit="contain" />
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000000",
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  grabberArea: {
    alignItems: "center",
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
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
  fullscreen: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
