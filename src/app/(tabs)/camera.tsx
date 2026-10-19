import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CameraPermissionPrompt } from "@/components/camera/camera-permission-prompt";
import { PhotoReview } from "@/components/camera/photo-review";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { saveLocalPhoto } from "@/lib/photoStorage";
import type { CapturedPhoto } from "@/types/photo";

const NOTICE_DURATION_MS = 2500;
const PHOTO_QUALITY = 0.8;

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<CameraType>("back");
  const [cameraReady, setCameraReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The preview unmounts when the tab loses focus; it reports ready again on remount.
  useFocusEffect(
    useCallback(() => {
      return () => setCameraReady(false);
    }, []),
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  async function takePicture() {
    const camera = cameraRef.current;
    if (camera === null || !cameraReady || taking) return;
    setTaking(true);
    try {
      const picture = await camera.takePictureAsync({ quality: PHOTO_QUALITY });
      setCameraReady(false);
      setCaptured({ uri: picture.uri, source: "camera" });
    } catch {
      setNotice("Foto konnte nicht aufgenommen werden.");
    } finally {
      setTaking(false);
    }
  }

  async function pickFromGallery() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: PHOTO_QUALITY,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset !== undefined) {
        setCameraReady(false);
        setCaptured({ uri: asset.uri, source: "gallery" });
      }
    } catch {
      setNotice("Galerie konnte nicht geöffnet werden.");
    }
  }

  function discardCapture() {
    setCaptured(null);
    setSaveError(null);
  }

  async function confirmPhoto(caption: string) {
    if (captured === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveLocalPhoto(captured.uri, caption);
      setCaptured(null);
      setNotice("Foto gespeichert 💪");
    } catch {
      setSaveError("Speichern fehlgeschlagen. Bitte versuche es erneut.");
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

  if (permission === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <CameraPermissionPrompt
        canAskAgain={permission.canAskAgain}
        onRequest={() => void requestPermission()}
        onPickFromGallery={() => void pickFromGallery()}
      />
    );
  }

  return (
    <View style={styles.container}>
      {isFocused && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mirror={facing === "front"}
          onCameraReady={() => setCameraReady(true)}
        />
      )}

      {notice !== null && (
        <View style={[styles.notice, { top: insets.top + spacing.md }]}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Foto aus Galerie wählen"
          onPress={() => void pickFromGallery()}
          style={styles.iconButton}
          hitSlop={spacing.sm}
        >
          <Ionicons name="images-outline" size={28} color={colors.text} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Foto aufnehmen"
          accessibilityState={{ disabled: !cameraReady || taking }}
          onPress={() => void takePicture()}
          disabled={!cameraReady || taking}
          style={({ pressed }) => [
            styles.shutter,
            (pressed || taking) && styles.shutterPressed,
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            facing === "back" ? "Zur Frontkamera wechseln" : "Zur Rückkamera wechseln"
          }
          onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
          style={styles.iconButton}
          hitSlop={spacing.sm}
        >
          <Ionicons name="camera-reverse-outline" size={28} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const SHUTTER_SIZE = 76;
const ICON_BUTTON_SIZE = 52;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
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
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  iconButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: radius.full,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterPressed: {
    opacity: 0.6,
  },
  shutterInner: {
    width: SHUTTER_SIZE - 16,
    height: SHUTTER_SIZE - 16,
    borderRadius: radius.full,
    backgroundColor: colors.text,
  },
});
