import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CameraCapture } from "@/components/camera/camera-capture";
import { StoryEditor } from "@/components/stories/story-editor";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import type { CapturedPhoto } from "@/types/photo";

const NOTICE_DURATION_MS = 2500;

/** Story flow: own camera (or gallery) first, then the editor with filters, text and tags. */
export default function StoryCreateScreen() {
  const insets = useSafeAreaInsets();
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (photo !== null) {
    return (
      <>
        <StatusBar hidden />
        <StoryEditor
          key={photo.uri}
          photoUri={photo.uri}
          onBack={() => setPhoto(null)}
          onShared={() => router.back()}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar hidden />
      <CameraCapture
        active
        onCapture={setPhoto}
        onError={setNotice}
        bottomInset={insets.bottom}
        overlay={
          <>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Story abbrechen"
              hitSlop={spacing.sm}
              style={[styles.close, { top: insets.top + spacing.sm }]}
            >
              <Ionicons name="close" size={28} color={colors.text} />
            </Pressable>
            <View style={[styles.titleBox, { top: insets.top + spacing.md }]} pointerEvents="none">
              <Text style={styles.title}>Story</Text>
            </View>
            {notice !== null && (
              <View style={[styles.notice, { top: insets.top + 64 }]} pointerEvents="none">
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}
          </>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  close: {
    position: "absolute",
    left: spacing.md,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  titleBox: {
    position: "absolute",
    alignSelf: "center",
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  notice: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
  },
  noticeText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
});
