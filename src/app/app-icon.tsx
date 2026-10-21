import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { APP_ICONS, appIconForNativeName, type AppIconOption } from "@/constants/appIcons";
import { fontSize, onPhoto, radius, spacing } from "@/constants/theme";
import { loadAppIconLibrary } from "@/lib/appIcon";
import { describeError } from "@/lib/errors";
import { makeStyles, useTheme } from "@/lib/theme";

const COLUMNS = 3;
/** iOS-like corner radius relative to the icon size. */
const ICON_CORNER_RATIO = 0.225;

type IconLibrary = NonNullable<Awaited<ReturnType<typeof loadAppIconLibrary>>>;

type State =
  | { status: "loading" }
  | { status: "no-native-module" }
  | { status: "unsupported-device" }
  | { status: "ready"; library: IconLibrary; current: string | null };

export default function AppIconScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<State>({ status: "loading" });
  const [changingTo, setChangingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadAppIconLibrary()
      .then((library) => {
        if (!active) return;
        if (library === null) setState({ status: "no-native-module" });
        else if (!library.supportsAlternateIcons) setState({ status: "unsupported-device" });
        else setState({ status: "ready", library, current: library.getAppIconName() });
      })
      .catch(() => {
        if (active) setState({ status: "no-native-module" });
      });
    return () => {
      active = false;
    };
  }, []);

  async function select(icon: AppIconOption) {
    if (state.status !== "ready" || changingTo !== null || icon.nativeName === state.current) return;
    setChangingTo(icon.id);
    setError(null);
    try {
      await state.library.setAlternateAppIcon(icon.nativeName);
      // Ask the library again instead of assuming, it is the source of truth.
      setState({ ...state, current: state.library.getAppIconName() });
    } catch (selectError) {
      setError(`Icon konnte nicht geändert werden – ${describeError(selectError)}`);
    } finally {
      setChangingTo(null);
    }
  }

  if (state.status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.status !== "ready") {
    return (
      <View style={styles.centered}>
        <Ionicons name="apps-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.hintTitle}>App-Icon nicht änderbar</Text>
        <Text style={styles.hint}>
          {state.status === "no-native-module"
            ? "Das Wechseln des App-Icons funktioniert nicht in Expo Go, sondern nur in einem eigenen Build der App (Dev-Build oder App-Store-Version)."
            : "Dein Gerät unterstützt keine alternativen App-Icons."}
        </Text>
      </View>
    );
  }

  const selected = appIconForNativeName(state.current);
  const tileWidth = (width - 2 * spacing.md - (COLUMNS - 1) * spacing.md) / COLUMNS;
  const iconSize = tileWidth - spacing.md;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Wähle, wie PeakPic auf deinem Home-Bildschirm aussieht.</Text>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <View style={styles.grid}>
        {APP_ICONS.map((icon) => {
          const isSelected = icon.id === selected.id;
          return (
            <Pressable
              key={icon.id}
              onPress={() => void select(icon)}
              disabled={changingTo !== null}
              accessibilityRole="radio"
              accessibilityLabel={`App-Icon ${icon.label}`}
              accessibilityState={{ selected: isSelected, busy: changingTo === icon.id }}
              style={({ pressed }) => [styles.tile, { width: tileWidth }, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.iconFrame,
                  { borderRadius: (iconSize + 8) * ICON_CORNER_RATIO },
                  isSelected && styles.iconFrameSelected,
                ]}
              >
                <Image
                  source={icon.preview}
                  style={{ width: iconSize, height: iconSize, borderRadius: iconSize * ICON_CORNER_RATIO }}
                  contentFit="cover"
                />
                {changingTo === icon.id && (
                  <View style={[styles.busy, { borderRadius: iconSize * ICON_CORNER_RATIO }]}>
                    <ActivityIndicator color={colors.onAccent} />
                  </View>
                )}
              </View>
              {isSelected && (
                <View style={styles.check}>
                  <Ionicons name="checkmark" size={14} color={colors.onAccent} />
                </View>
              )}
              <Text style={[styles.label, isSelected && styles.labelSelected]} numberOfLines={1}>
                {icon.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: spacing.md,
      gap: spacing.md,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    hintTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      lineHeight: 22,
      textAlign: "center",
    },
    intro: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    tile: {
      alignItems: "center",
      gap: spacing.xs,
    },
    pressed: {
      opacity: 0.7,
    },
    iconFrame: {
      padding: 4,
      borderWidth: 2,
      borderColor: "transparent",
    },
    iconFrameSelected: {
      borderColor: colors.accent,
    },
    busy: {
      position: "absolute",
      top: 4,
      left: 4,
      right: 4,
      bottom: 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: onPhoto.scrim,
    },
    check: {
      position: "absolute",
      top: -4,
      right: 0,
      width: 22,
      height: 22,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: colors.background,
    },
    label: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    labelSelected: {
      color: colors.text,
      fontWeight: "700",
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.sm,
    },
  }),
);
