import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { radius, spacing, typography } from "@/constants/theme";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/names";
import { useOnboarding } from "@/lib/onboarding";
import { NameChangeError, getMyProfile, updateMyNames } from "@/lib/profileRepo";
import { makeStyles, useTheme } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

type Page = { icon: IconName; accent?: boolean; title: string; text: string };

/** Only what the app can do today. */
const PAGES: Page[] = [
  {
    icon: "flame",
    accent: true,
    title: "Ein Foto pro Training",
    text: "Nimm nach dem Training ein Foto auf. Jeder Tag mit Foto zählt für deinen Streak und erscheint mit einer Flamme im Kalender.",
  },
  {
    icon: "people-outline",
    title: "Feed, Storys und Chats",
    text: "Teile dein Workout im Feed oder als Story, folge anderen und schreib ihnen im Chat. Wer was sieht, legst du in den Einstellungen fest.",
  },
  {
    icon: "list-outline",
    title: "Plan und Ruhetage",
    text: "Im Profil kannst du einen Trainingsplan anlegen und Ruhetage pro Woche festlegen. Beides ist freiwillig.",
  },
];

/** The pages plus the name step at the end. */
const STEP_COUNT = PAGES.length + 1;

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // "Einführung nochmal ansehen" from the settings: nothing is saved, it just closes.
  const replay = useLocalSearchParams<{ replay?: string }>().replay === "1";
  const { needed, markSeen, complete } = useOnboarding();
  const [closing, setClosing] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [initialName, setInitialName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // From now on the intro is never forced again on this device, even if it is interrupted.
  useEffect(() => {
    if (!replay) markSeen();
  }, [replay, markSeen]);

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        setInitialName(profile.displayName);
        setDisplayName(profile.displayName);
      })
      .catch(() => undefined);
  }, []);

  // Into the app only once the intro counts as done, so the router guards already let it through
  // (replacing earlier would go nowhere and leave the intro on screen).
  useEffect(() => {
    if (closing && needed === false) router.replace("/");
  }, [closing, needed]);

  function close() {
    if (replay) {
      router.back();
      return;
    }
    complete();
    setClosing(true);
  }

  function goTo(next: number) {
    scroller.current?.scrollTo({ x: next * width, animated: true });
    setStep(next);
  }

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setStep(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  async function finish() {
    const trimmed = displayName.trim();
    if (replay || initialName === null || trimmed === initialName) {
      close();
      return;
    }
    setSaving(true);
    setNameError(null);
    try {
      await updateMyNames({ displayName: trimmed });
      close();
    } catch (error) {
      setNameError(
        error instanceof NameChangeError
          ? error.message
          : "Der Name konnte nicht gespeichert werden. Du kannst ihn später im Profil ändern.",
      );
    } finally {
      setSaving(false);
    }
  }

  const isLast = step === STEP_COUNT - 1;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Button label={replay ? "Schliessen" : "Überspringen"} variant="ghost" size="sm" onPress={close} />
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        keyboardShouldPersistTaps="handled"
        style={styles.pager}
      >
        {PAGES.map((page) => (
          <View key={page.title} style={[styles.page, { width }]}>
            <View style={styles.illustration}>
              <Ionicons name={page.icon} size={56} color={page.accent === true ? colors.accent : colors.textSecondary} />
            </View>
            <Text style={styles.title} accessibilityRole="header">
              {page.title}
            </Text>
            <Text style={styles.text}>{page.text}</Text>
          </View>
        ))}

        <View style={[styles.page, { width }]}>
          <View style={styles.illustration}>
            <Ionicons name="person-outline" size={56} color={colors.textSecondary} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Dein Anzeigename
          </Text>
          <Text style={styles.text}>So sehen dich andere im Profil und in Listen. Du kannst ihn jederzeit ändern.</Text>
          <View style={styles.field}>
            <TextField
              label="Anzeigename"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              error={nameError}
              hint="Muss nicht eindeutig sein."
              editable={!replay}
              returnKeyType="done"
              onSubmitEditing={() => void finish()}
            />
          </View>
          <Text style={styles.note}>Plan und Ruhetage kannst du später im Profil einrichten.</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.dots} accessibilityLabel={`Schritt ${step + 1} von ${STEP_COUNT}`}>
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <Pressable
              key={index}
              onPress={() => goTo(index)}
              hitSlop={spacing.sm}
              accessibilityRole="button"
              accessibilityLabel={`Zu Schritt ${index + 1}`}
            >
              <View style={[styles.dot, index === step && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
        {isLast ? (
          <>
            <Button label="Fertig" onPress={() => void finish()} loading={saving} />
            {nameError !== null && <Button label="Ohne Namen fortfahren" variant="ghost" onPress={close} />}
          </>
        ) : (
          <Button label="Weiter" onPress={() => goTo(step + 1)} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      alignItems: "flex-end",
      paddingHorizontal: spacing.sm,
    },
    pager: {
      flex: 1,
    },
    page: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
    },
    illustration: {
      width: 112,
      height: 112,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    title: {
      ...typography.title,
      color: colors.text,
      textAlign: "center",
    },
    text: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: "center",
      maxWidth: 360,
    },
    field: {
      alignSelf: "stretch",
      marginTop: spacing.sm,
    },
    note: {
      ...typography.caption,
      color: colors.textSecondary,
      textAlign: "center",
    },
    footer: {
      gap: spacing.ms,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    dots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: spacing.sm,
      paddingBottom: spacing.sm,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: radius.full,
      backgroundColor: colors.border,
    },
    dotActive: {
      width: 20,
      backgroundColor: colors.text,
    },
  }),
);
