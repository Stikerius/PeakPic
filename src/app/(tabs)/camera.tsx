import { router, useFocusEffect, useIsFocused, useNavigation } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CameraCapture } from "@/components/camera/camera-capture";
import { PhotoReview } from "@/components/camera/photo-review";
import { fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { getPendingWorkoutLink, linkPendingWorkout, setPendingShareWithPost, setPendingWorkoutLink } from "@/lib/pendingWorkoutLink";
import { fetchMyPlan, fetchPlanProofs, type TrainingPlan } from "@/lib/planRepo";
import { createPost, getTodaysDayPostId } from "@/lib/postRepo";
import { nextPlanDayIndex } from "@/lib/streak";
import { DarkScheme, makeStyles } from "@/lib/theme";
import type { CapturedPhoto } from "@/types/photo";
import { useTrackScreen } from "@/lib/usage";

const NOTICE_DURATION_MS = 2500;

/** The bits of the tab navigator this screen needs; expo-router doesn't export its tab types. */
type TabScreenNavigation = {
  addListener(type: "tabPress", callback: () => void): () => void;
  isFocused(): boolean;
};

export default function CameraScreen() {
  useTrackScreen("screen_camera");
  // The camera is always dark; the tab stays mounted, so only claim the status bar while shown.
  const isFocused = useIsFocused();
  return (
    <DarkScheme>
      {isFocused && <StatusBar style="light" />}
      <CameraScreenContent />
    </DarkScheme>
  );
}

function CameraScreenContent() {
  const styles = useStyles();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<TabScreenNavigation>();

  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // My plan and the unit due next; null without a plan (then nothing about plans is shown).
  const [plan, setPlan] = useState<{ plan: TrainingPlan; nextIndex: number } | null>(null);
  // "Fotos hinzufügen" after a recorded training: the next post belongs to it.
  const [workoutLink, setWorkoutLink] = useState(() => getPendingWorkoutLink());

  useFocusEffect(
    useCallback(() => {
      setWorkoutLink(getPendingWorkoutLink());
      let active = true;
      Promise.all([fetchMyPlan(), fetchPlanProofs()])
        .then(([myPlan, proofs]) => {
          if (!active) return;
          setPlan(
            myPlan !== null
              ? { plan: myPlan, nextIndex: nextPlanDayIndex(myPlan.days.map((d) => d.id), proofs) }
              : null,
          );
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

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

  function openEditor(photoUri: string, mode: "day" | "single" | "append", planDayId: string | null, postId?: string) {
    router.push({
      pathname: "/post-create",
      params: {
        photoUri,
        mode,
        ...(postId !== undefined ? { postId } : {}),
        ...(planDayId !== null ? { planDayId } : {}),
      },
    });
    discardCapture();
  }

  /** "Nein" to the feed: store the photo as today's proof for streak and calendar only. */
  async function saveProofOnly(photoUri: string, planDayId: string | null, isDayPost = true) {
    setSaving(true);
    setSaveError(null);
    try {
      const postId = await createPost({
        photos: [{ existing: null, originalUri: photoUri, renderedUri: null, edits: null, changed: true }],
        caption: "",
        inFeed: false,
        isDayPost,
        showInProfile: true,
        tagIds: [],
        planDayId,
      });
      await linkPendingWorkout(postId);
      setWorkoutLink(null);
      emitAppEvent("postCreated", undefined);
      setCaptured(null);
      setNotice("Training gespeichert 💪");
    } catch (error) {
      // Shows up in the dev server terminal, so upload problems can be diagnosed.
      console.error("[camera] Workout speichern fehlgeschlagen:", error);
      setSaveError(`Hochladen fehlgeschlagen – ${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  /**
   * The first proof of the day counts for the streak and asks whether it also goes to the
   * feed. Later photos of the day go into today's slideshow or become a single post.
   */
  async function confirmPhoto(planDayId: string | null) {
    if (captured === null) return;
    const photoUri = captured.uri;
    setSaving(true);
    setSaveError(null);
    let dayPostId: string | null;
    try {
      dayPostId = await getTodaysDayPostId();
    } catch (error) {
      setSaveError(`Konnte nicht prüfen, ob du heute schon gepostet hast – ${describeError(error)}`);
      return;
    } finally {
      setSaving(false);
    }

    // Photos of a recorded training: the training is the proof, the photos don't count on their
    // own and don't take the day's slideshow (a later real proof of the day still can).
    if (workoutLink !== null) {
      Alert.alert(
        "Auch im Feed veröffentlichen?",
        workoutLink.countsForStreak
          ? "Dein Training zählt schon für den Streak, die Fotos werden dazu gespeichert."
          : "Dein Training zählt nicht für den Streak, und die Fotos dazu auch nicht.",
        [
          { text: "Nein, nur beim Training speichern", onPress: () => void saveProofOnly(photoUri, planDayId, false) },
          { text: "Ja, bearbeiten und posten", onPress: () => openEditor(photoUri, "single", planDayId) },
          { text: "Abbrechen", style: "cancel" },
        ],
      );
      return;
    }

    if (dayPostId === null) {
      Alert.alert("Auch im Feed veröffentlichen?", "Dein erster Trainingsnachweis heute zählt für deinen Streak.", [
        { text: "Nein, nur für den Streak", onPress: () => void saveProofOnly(photoUri, planDayId) },
        { text: "Ja, bearbeiten und posten", onPress: () => openEditor(photoUri, "day", planDayId) },
        { text: "Abbrechen", style: "cancel" },
      ]);
      return;
    }
    const todaysPost = dayPostId;
    Alert.alert("Du hast heute schon gepostet", "Dein Streak zählt heute schon. Wohin soll das Foto?", [
      { text: "Zur Slideshow von heute hinzufügen", onPress: () => openEditor(photoUri, "append", planDayId, todaysPost) },
      { text: "Nur als einzelner Post", onPress: () => openEditor(photoUri, "single", planDayId) },
      { text: "Abbrechen", style: "cancel" },
    ]);
  }

  if (captured !== null) {
    return (
      <PhotoReview
        key={captured.uri}
        photo={captured}
        saving={saving}
        error={saveError}
        onRetake={discardCapture}
        onUse={(planDayId) => void confirmPhoto(planDayId)}
        plan={plan}
        workout={
          workoutLink !== null
            ? {
                planDayId: workoutLink.planDayId,
                shareWithPost: workoutLink.shareWithPost,
                onShareChange: (share) => {
                  setPendingShareWithPost(share);
                  setWorkoutLink(getPendingWorkoutLink());
                },
              }
            : null
        }
      />
    );
  }

  return (
    <CameraCapture
      active={isFocused}
      onCapture={setCaptured}
      onError={setNotice}
      overlay={
        notice !== null ? (
          <View style={[styles.notice, { top: insets.top + spacing.md }]}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : workoutLink !== null ? (
          <Pressable
            onPress={() => {
              setPendingWorkoutLink(null);
              setWorkoutLink(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Fotos für dein Training. Antippen zum Abbrechen."
            style={[styles.notice, { top: insets.top + spacing.md }]}
          >
            <Text style={styles.noticeText}>Fotos für dein Training · Abbrechen</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    notice: {
      position: "absolute",
      alignSelf: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceRaised,
    },
    noticeText: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
  }),
);
