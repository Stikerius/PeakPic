import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlanChoice } from "@/components/camera/plan-choice";
import { Button } from "@/components/ui/button";
import { fontSize, onPhoto, radius, spacing } from "@/constants/theme";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";
import { planEntries, type TrainingPlan } from "@/lib/planRepo";
import { nextTrainingIndex } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import type { CapturedPhoto } from "@/types/photo";

type PhotoReviewProps = {
  photo: CapturedPhoto;
  saving: boolean;
  error: string | null;
  /** Discards the photo and returns to the live camera (button or swipe down). */
  onRetake: () => void;
  /** Continue with this photo and the chosen plan unit (null: not part of the plan). */
  onUse: (planDayId: string | null) => void;
  /** Only for people with a plan: shows "Gehört zu deinem Plan?". */
  plan?: { plan: TrainingPlan; nextIndex: number } | null;
  /**
   * Photos for a recorded training: no plan question (the plan day comes from the training),
   * instead "Trainingsbericht beim Beitrag zeigen".
   */
  workout?: { planDayId: string | null; shareWithPost: boolean; onShareChange: (share: boolean) => void } | null;
};

export function PhotoReview({
  photo,
  saving,
  error,
  onRetake,
  onUse,
  plan = null,
  workout = null,
}: PhotoReviewProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  // Pre-selected: the training day due next (a rest day due: the one after it).
  const [planDayId, setPlanDayId] = useState<string | null>(
    plan !== null ? (plan.plan.days[nextTrainingIndex(planEntries(plan.plan), plan.nextIndex)]?.id ?? null) : null,
  );
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
        <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
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

          <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.md }]}>
            {workout !== null && (
              <View style={styles.workoutRow}>
                <Text style={styles.workoutText}>Trainingsbericht beim Beitrag zeigen</Text>
                <Switch
                  value={workout.shareWithPost}
                  onValueChange={workout.onShareChange}
                  disabled={saving}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  accessibilityLabel="Trainingsbericht beim Beitrag zeigen"
                />
              </View>
            )}
            {plan !== null && workout === null && (
              <PlanChoice
                plan={plan.plan}
                nextIndex={plan.nextIndex}
                value={planDayId}
                onChange={setPlanDayId}
                disabled={saving}
              />
            )}
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
                onPress={() => onUse(workout !== null ? workout.planDayId : plan !== null ? planDayId : null)}
                loading={saving}
                style={styles.action}
              />
            </View>
          </View>
        </View>
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

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: onPhoto.background,
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
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    controls: {
      gap: spacing.md,
      padding: spacing.md,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.sm,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.md,
    },
    workoutRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    workoutText: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
    },
    action: {
      flex: 1,
    },
    fullscreen: {
      flex: 1,
      backgroundColor: onPhoto.background,
    },
  }),
);
