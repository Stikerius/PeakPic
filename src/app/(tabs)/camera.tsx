import { useIsFocused, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CameraCapture } from "@/components/camera/camera-capture";
import { PhotoReview } from "@/components/camera/photo-review";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { workoutRepo } from "@/lib/workoutRepo";
import type { CapturedPhoto } from "@/types/photo";

const NOTICE_DURATION_MS = 2500;

/** The bits of the tab navigator this screen needs; expo-router doesn't export its tab types. */
type TabScreenNavigation = {
  addListener(type: "tabPress", callback: () => void): () => void;
  isFocused(): boolean;
};

export default function CameraScreen() {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<TabScreenNavigation>();

  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Tapping the camera tab while it is already open discards the photo under review.
  useEffect(() => {
    return navigation.addListener("tabPress", () => {
      if (navigation.isFocused()) discardCapture();
    });
  }, [navigation]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function discardCapture() {
    setCaptured(null);
    setSaveError(null);
  }

  async function confirmPhoto(caption: string) {
    if (captured === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await workoutRepo.addWorkout({ sourceUri: captured.uri, caption });
      emitAppEvent("postCreated", undefined);
      setCaptured(null);
      setNotice("Workout gepostet 💪");
    } catch (error) {
      // Shows up in the dev server terminal, so upload problems can be diagnosed.
      console.error("[camera] Workout speichern fehlgeschlagen:", error);
      setSaveError(`Hochladen fehlgeschlagen – ${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  if (captured !== null) {
    return (
      <PhotoReview
        key={captured.uri}
        photo={captured}
        saving={saving}
        error={saveError}
        onRetake={discardCapture}
        onUse={(caption) => void confirmPhoto(caption)}
      />
    );
  }

  return (
    <CameraCapture
      active={isFocused}
      onCapture={setCaptured}
      onError={setNotice}
      overlay={
        notice !== null && (
          <View style={[styles.notice, { top: insets.top + spacing.md }]}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
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
