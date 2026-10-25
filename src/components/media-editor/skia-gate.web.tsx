import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { ErrorState } from "@/components/ui/empty-state";
import { spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * Web: the photo editor draws with Skia, which the browser runs as WebAssembly (CanvasKit, served
 * as /canvaskit.wasm by the web build). It is loaded only when the editor opens, once per page.
 */
export function SkiaGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [state, setState] = useState<"loading" | "ready" | "failed">(() => (globalThis.CanvasKit !== undefined ? "ready" : "loading"));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (globalThis.CanvasKit !== undefined) return;
    let active = true;
    LoadSkiaWeb({ locateFile: (file: string) => `/${file}` })
      .then(() => active && setState("ready"))
      .catch(() => active && setState("failed"));
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state === "ready") return children;
  if (state === "failed") {
    return (
      <ErrorState
        fill
        message="Die Bildbearbeitung konnte nicht geladen werden."
        onRetry={() => {
          setState("loading");
          setAttempt((a) => a + 1);
        }}
      />
    );
  }
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Bildbearbeitung wird geladen">
      <ActivityIndicator color={colors.textSecondary} />
      <Text style={styles.text}>Bildbearbeitung wird geladen …</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.background,
    },
    text: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
