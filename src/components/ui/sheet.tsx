import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, spacing, typography } from "@/constants/theme";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";
import { makeStyles, useTheme } from "@/lib/theme";

type SheetProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Height as a fraction of the screen. */
  heightFraction?: number;
  children: ReactNode;
};

/**
 * Sheet from the bottom over a dimmed backdrop. Closes by dragging the header down
 * (useSwipeToDismiss), tapping the backdrop or the close button.
 */
export function Sheet({ visible, title, onClose, heightFraction = 0.6, children }: SheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const swipe = useSwipeToDismiss({ onDismiss: onClose, fadeTo: 1 });
  // Only the shared value goes into the worklet; the swipe object also holds the gesture.
  const { translateY } = swipe;
  const sheetHeight = height * heightFraction;
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight], [1, 0], "clamp"),
  }));

  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Schliessen" />
        </Animated.View>
        <KeyboardAvoidingView
          style={[styles.keyboard, { paddingTop: insets.top + spacing.lg }]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[styles.sheet, { height: sheetHeight, paddingBottom: insets.bottom }, swipe.animatedStyle]}
          >
            <GestureDetector gesture={swipe.gesture}>
              <View style={styles.header} collapsable={false}>
                <View style={styles.grabber} />
                <View style={styles.titleRow}>
                  <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                    {title}
                  </Text>
                  <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Schliessen"
                    style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
            </GestureDetector>
            <View style={styles.body}>{children}</View>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    backdrop: {
      backgroundColor: colors.backdrop,
    },
    keyboard: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheet: {
      flexShrink: 1,
      overflow: "hidden",
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    header: {
      alignItems: "center",
      gap: spacing.xs,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    grabber: {
      width: 36,
      height: 5,
      borderRadius: radius.full,
      backgroundColor: colors.border,
    },
    titleRow: {
      alignSelf: "stretch",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    title: {
      ...typography.bodyStrong,
      flex: 1,
      color: colors.text,
    },
    close: {
      width: 44,
      height: 44,
      marginRight: -spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    closePressed: {
      opacity: 0.6,
    },
    body: {
      flex: 1,
    },
  }),
);
