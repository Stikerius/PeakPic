import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { CameraPermissionPrompt } from "@/components/camera/camera-permission-prompt";
import { colors, radius, spacing } from "@/constants/theme";
import type { CapturedPhoto } from "@/types/photo";

const PHOTO_QUALITY = 0.8;

/** Remembered across mounts, so retaking a selfie stays on the front camera. */
let lastFacing: CameraType = "back";

type CameraCaptureProps = {
  /** The preview only runs while active (e.g. tab focused), to save battery. */
  active: boolean;
  onCapture: (photo: CapturedPhoto) => void;
  onError: (message: string) => void;
  /** Rendered above the preview, e.g. a close button or a notice. */
  overlay?: ReactNode;
  /** Extra space below the controls, e.g. the home indicator when there's no tab bar. */
  bottomInset?: number;
};

/**
 * Live camera with shutter, front/back switch (button or double tap) and gallery picker.
 * Handles the camera permission, including the "denied" state.
 */
export function CameraCapture({
  active,
  onCapture,
  onError,
  overlay,
  bottomInset = 0,
}: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>(lastFacing);
  const [cameraReady, setCameraReady] = useState(false);
  const [taking, setTaking] = useState(false);

  // The preview unmounts while inactive; it reports ready again on remount.
  useEffect(() => {
    if (!active) setCameraReady(false);
  }, [active]);

  async function takePicture() {
    const camera = cameraRef.current;
    if (camera === null || !cameraReady || taking) return;
    setTaking(true);
    try {
      const picture = await camera.takePictureAsync({ quality: PHOTO_QUALITY });
      setCameraReady(false);
      onCapture({ uri: picture.uri, source: "camera" });
    } catch {
      onError("Foto konnte nicht aufgenommen werden.");
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
        onCapture({ uri: asset.uri, source: "gallery" });
      }
    } catch {
      onError("Galerie konnte nicht geöffnet werden.");
    }
  }

  function flipCamera() {
    const next = facing === "back" ? "front" : "back";
    lastFacing = next;
    setFacing(next);
  }

  const doubleTapToFlip = Gesture.Tap().numberOfTaps(2).runOnJS(true).onStart(flipCamera);

  if (permission === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        {overlay}
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.flex}>
        <CameraPermissionPrompt
          canAskAgain={permission.canAskAgain}
          onRequest={() => void requestPermission()}
          onPickFromGallery={() => void pickFromGallery()}
        />
        {overlay}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GestureDetector gesture={doubleTapToFlip}>
        <View
          style={StyleSheet.absoluteFill}
          collapsable={false}
          accessibilityHint="Doppelt tippen, um die Kamera zu wechseln"
        >
          {active && (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mirror={facing === "front"}
              onCameraReady={() => setCameraReady(true)}
            />
          )}
        </View>
      </GestureDetector>

      {overlay}

      <View style={[styles.controls, { bottom: spacing.xl + bottomInset }]}>
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
          style={({ pressed }) => [styles.shutter, (pressed || taking) && styles.shutterPressed]}
        >
          <View style={styles.shutterInner} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={facing === "back" ? "Zur Frontkamera wechseln" : "Zur Rückkamera wechseln"}
          onPress={flipCamera}
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
  flex: {
    flex: 1,
  },
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
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
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
