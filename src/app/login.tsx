import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import { MIN_AGE_YEARS } from "@/constants/app";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import {
  MIN_PASSWORD_LENGTH,
  USERNAME_PATTERN,
  normalizeUsername,
  signIn,
  signUp,
} from "@/lib/auth";
import { confirmLegalDocuments, fetchCurrentLegalDocuments, type LegalDocument } from "@/lib/legalRepo";
import { useLegalViewed } from "@/lib/legalViewed";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/names";
import { makeStyles, useTheme } from "@/lib/theme";
import type { LegalDocType } from "@/types/database";

function openLegal(docType: LegalDocType) {
  router.push({ pathname: "/legal/[docType]", params: { docType } });
}

type Mode = "login" | "register";

function validate(mode: Mode, email: string, password: string, username: string): string | null {
  if (!email.includes("@")) return "Bitte gib eine gültige E-Mail-Adresse ein.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
  }
  if (mode === "register" && !USERNAME_PATTERN.test(normalizeUsername(username))) {
    return "Username: 3–20 Zeichen, nur Buchstaben, Zahlen, _ und Punkt.";
  }
  return null;
}

export default function LoginScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Exactly the versions shown here are confirmed after sign-up.
  const [legalDocs, setLegalDocs] = useState<LegalDocument[] | null>(null);
  const [legalFailed, setLegalFailed] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acknowledgedPrivacy, setAcknowledgedPrivacy] = useState(false);
  const [confirmedAge, setConfirmedAge] = useState(false);
  const privacyViewed = useLegalViewed("privacy");

  useEffect(() => {
    let active = true;
    fetchCurrentLegalDocuments()
      .then((docs) => {
        if (active) setLegalDocs(docs);
      })
      .catch(() => {
        if (active) setLegalFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const terms = legalDocs?.find((doc) => doc.docType === "terms");
  const privacy = legalDocs?.find((doc) => doc.docType === "privacy");
  const legalReady = terms !== undefined && privacy !== undefined;
  const canRegister = legalReady && acceptedTerms && acknowledgedPrivacy && confirmedAge;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  // On success the session listener flips the route guard; nothing to navigate here.
  async function submit() {
    const validationError = validate(mode, email, password, username);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        setError(await signIn(email, password));
        return;
      }
      if (!canRegister || terms === undefined || privacy === undefined) {
        setError("Bitte bestätige die Nutzungsbedingungen, die Datenschutzerklärung und dein Alter.");
        return;
      }
      const result = await signUp(email, password, username, displayName);
      if (result.status === "error") setError(result.message);
      if (result.status === "signed-in") {
        // If this fails (network), the legal screen after login asks again.
        await confirmLegalDocuments([terms.id, privacy.id]).catch(() => undefined);
      }
      if (result.status === "confirm-email") {
        setInfo(
          "Fast geschafft! Wir haben dir eine E-Mail geschickt. Bestätige den Link darin und melde dich dann hier an.",
        );
        setMode("login");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Ionicons name="flame" size={56} color={colors.accent} />
          <Text style={styles.title}>PeakPic</Text>
          <Text style={styles.subtitle}>
            {mode === "login" ? "Willkommen zurück!" : "Starte deinen Streak."}
          </Text>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {(["login", "register"] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              onPress={() => switchMode(m)}
              style={[styles.tab, mode === m && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, mode === m && styles.tabLabelActive]}>
                {m === "login" ? "Anmelden" : "Registrieren"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.form}>
          {mode === "register" && (
            <TextField
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="z.B. lena.lifts"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              textContentType="username"
              maxLength={20}
              hint="3–20 Zeichen: a–z, 0–9, _ und Punkt"
            />
          )}
          {mode === "register" && (
            <TextField
              label="Anzeigename (optional)"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={normalizeUsername(username) || "z.B. Lena"}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              hint="Muss nicht eindeutig sein. Leer lassen = Username."
            />
          )}
          <TextField
            label="E-Mail"
            value={email}
            onChangeText={setEmail}
            placeholder="du@beispiel.ch"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextField
            label="Passwort"
            value={password}
            onChangeText={setPassword}
            placeholder={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            textContentType={mode === "login" ? "password" : "newPassword"}
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
          />

          {mode === "register" && (
            <View style={styles.legal}>
              {legalFailed ? (
                <Text style={styles.error}>Die Rechtstexte konnten nicht geladen werden. Prüfe deine Verbindung.</Text>
              ) : legalDocs !== null && !legalReady ? (
                <Text style={styles.error}>Registrierung ist im Moment nicht möglich.</Text>
              ) : null}
              <Checkbox
                checked={acceptedTerms}
                onChange={setAcceptedTerms}
                disabled={!legalReady}
                accessibilityLabel="Ich akzeptiere die Nutzungsbedingungen"
              >
                <Text style={styles.legalText}>
                  Ich akzeptiere die{" "}
                  <Text style={styles.inlineLink} onPress={() => openLegal("terms")} accessibilityRole="link">
                    Nutzungsbedingungen
                  </Text>
                  .
                </Text>
              </Checkbox>
              <Checkbox
                checked={acknowledgedPrivacy}
                onChange={setAcknowledgedPrivacy}
                disabled={!legalReady || !privacyViewed}
                accessibilityLabel="Ich habe die Datenschutzerklärung gelesen und zur Kenntnis genommen"
              >
                <Text style={styles.legalText}>
                  Ich habe die{" "}
                  <Text style={styles.inlineLink} onPress={() => openLegal("privacy")} accessibilityRole="link">
                    Datenschutzerklärung
                  </Text>{" "}
                  gelesen und zur Kenntnis genommen.
                </Text>
                {!privacyViewed && <Text style={styles.legalHint}>Öffne sie zuerst über den Link.</Text>}
              </Checkbox>
              <Checkbox
                checked={confirmedAge}
                onChange={setConfirmedAge}
                disabled={!legalReady}
                accessibilityLabel={`Ich bin mindestens ${MIN_AGE_YEARS} Jahre alt`}
              >
                <Text style={styles.legalText}>Ich bin mindestens {MIN_AGE_YEARS} Jahre alt.</Text>
              </Checkbox>
            </View>
          )}

          {error !== null && <Text style={styles.error}>{error}</Text>}
          {info !== null && <Text style={styles.info}>{info}</Text>}

          <Button
            label={mode === "login" ? "Anmelden" : "Konto erstellen"}
            onPress={() => void submit()}
            loading={submitting}
            disabled={mode === "register" && !canRegister}
          />

          <View style={styles.legalLinks}>
            <Text style={styles.link} onPress={() => openLegal("terms")} accessibilityRole="link">
              Nutzungsbedingungen
            </Text>
            <Text style={styles.legalHint}>·</Text>
            <Text style={styles.link} onPress={() => openLegal("privacy")} accessibilityRole="link">
              Datenschutzerklärung
            </Text>
            <Text style={styles.legalHint}>·</Text>
            <Text style={styles.link} onPress={() => openLegal("guidelines")} accessibilityRole="link">
              Richtlinien
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.lg,
      gap: spacing.xl,
    },
    brand: {
      alignItems: "center",
      gap: spacing.xs,
    },
    title: {
      color: colors.text,
      fontSize: 36,
      fontWeight: "800",
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
    },
    tabs: {
      flexDirection: "row",
      padding: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      alignItems: "center",
    },
    tabActive: {
      backgroundColor: colors.surfaceRaised,
    },
    tabLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
    tabLabelActive: {
      color: colors.text,
    },
    form: {
      gap: spacing.md,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.sm,
    },
    info: {
      color: colors.success,
      fontSize: fontSize.sm,
      lineHeight: 20,
    },
    legal: {
      gap: spacing.ms,
    },
    legalText: {
      ...typography.body,
      color: colors.text,
    },
    legalHint: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    link: {
      ...typography.caption,
      color: colors.text,
      fontWeight: "600",
      textDecorationLine: "underline",
    },
    legalLinks: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: spacing.sm,
    },
    inlineLink: {
      fontWeight: "600",
      textDecorationLine: "underline",
    },
  }),
);
