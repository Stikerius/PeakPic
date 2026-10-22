import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { appIconForNativeName } from "@/constants/appIcons";
import { fontSize, radius, spacing, type ThemePreference } from "@/constants/theme";
import { useFollowRequestCount } from "@/hooks/use-follow-requests";
import { loadAppIconLibrary } from "@/lib/appIcon";
import { signOut } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { useLegalGate } from "@/lib/legalGate";
import { LEGAL_TYPE_LABELS } from "@/lib/legalRepo";
import { listHiddenUserIds } from "@/lib/privacyRepo";
import {
  getMyProfile,
  getMyTagSettings,
  updatePrivacy,
  updateTagSettings,
  type PrivacySettings,
  type TagSettings,
} from "@/lib/profileRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { AudienceScope, TagPermission, Visibility } from "@/types/database";
import { setUsageEnabled, useTrackScreen, useUsageEnabled } from "@/lib/usage";

type RowProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
};

function SettingsRow({ icon, title, subtitle, onPress }: RowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

type ChoiceProps<T extends string> = {
  title: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
};

/** Titled segmented choice ("Alle" / "Nur Follower", "Wer darf mich markieren", …). */
function Choice<T extends string>({ title, value, options, disabled = false, onChange }: ChoiceProps<T>) {
  const styles = useStyles();
  return (
    <View style={styles.choiceRow}>
      <Text style={[styles.rowTitle, disabled && styles.disabled]}>{title}</Text>
      <SegmentedControl
        value={value}
        options={options}
        disabled={disabled}
        onChange={onChange}
        accessibilityLabel={title}
      />
    </View>
  );
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "everyone", label: "Alle" },
  { value: "followers", label: "Nur Follower" },
];

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
];

const TAG_OPTIONS: { value: TagPermission; label: string }[] = [
  { value: "everyone", label: "Alle" },
  { value: "connections", label: "Verbindungen" },
  { value: "nobody", label: "Niemand" },
];

function countLabel(count: number | undefined): string {
  if (count === undefined) return "…";
  if (count === 0) return "Alle Follower sehen sie";
  return `Verborgen vor ${count} ${count === 1 ? "Person" : "Personen"}`;
}

export default function SettingsScreen() {
  useTrackScreen("screen_settings");
  const { colors, preference, setPreference } = useTheme();
  const styles = useStyles();
  const [counts, setCounts] = useState<Partial<Record<AudienceScope, number>>>({});
  const [appIconLabel, setAppIconLabel] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [tags, setTags] = useState<TagSettings | null>(null);
  const requestCount = useFollowRequestCount();
  const legal = useLegalGate();
  const usageEnabled = useUsageEnabled();

  useFocusEffect(
    useCallback(() => {
      getMyProfile()
        .then(({ isPrivate, storyVisibility, postVisibility }) => setPrivacy({ isPrivate, storyVisibility, postVisibility }))
        .catch(() => undefined);
      getMyTagSettings()
        .then(setTags)
        .catch(() => undefined);
      void Promise.all([listHiddenUserIds("stories"), listHiddenUserIds("posts")])
        .then(([stories, posts]) => setCounts({ stories: stories.size, posts: posts.size }))
        .catch(() => undefined);
      loadAppIconLibrary()
        .then((library) =>
          setAppIconLabel(
            library?.supportsAlternateIcons
              ? appIconForNativeName(library.getAppIconName()).label
              : "Nur in der installierten App verfügbar",
          ),
        )
        .catch(() => undefined);
    }, []),
  );

  function open(scope: AudienceScope) {
    router.push({ pathname: "/privacy/[scope]", params: { scope } });
  }

  async function save(change: Partial<PrivacySettings>) {
    if (privacy === null) return;
    const previous = privacy;
    setPrivacy({ ...privacy, ...change }); // optimistic
    try {
      await updatePrivacy(change);
      emitAppEvent("followChanged", undefined);
    } catch (error) {
      setPrivacy(previous);
      Alert.alert("Speichern fehlgeschlagen", describeError(error));
    }
  }

  async function saveTags(change: Partial<TagSettings>) {
    if (tags === null) return;
    const previous = tags;
    setTags({ ...tags, ...change }); // optimistic
    try {
      await updateTagSettings(change);
    } catch (error) {
      setTags(previous);
      Alert.alert("Speichern fehlgeschlagen", describeError(error));
    }
  }

  function setPrivate(isPrivate: boolean) {
    if (!isPrivate && requestCount > 0) {
      Alert.alert(
        "Profil öffentlich machen?",
        `${requestCount} offene ${requestCount === 1 ? "Anfrage wird" : "Anfragen werden"} dabei automatisch bestätigt.`,
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Öffentlich machen", onPress: () => void save({ isPrivate: false }) },
        ],
      );
      return;
    }
    void save({ isPrivate });
  }

  function confirmSignOut() {
    Alert.alert("Abmelden?", "Du kannst dich jederzeit wieder anmelden.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Abmelden", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Konto</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="lock-closed-outline" size={22} color={colors.text} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Privates Profil</Text>
            <Text style={styles.rowSubtitle}>Neue Follower müssen von dir bestätigt werden</Text>
          </View>
          <Switch
            value={privacy?.isPrivate ?? true}
            onValueChange={setPrivate}
            disabled={privacy === null}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel="Privates Profil"
          />
        </View>
        <View style={styles.separator} />
        <Choice
          title="Wer sieht meine Storys"
          options={VISIBILITY_OPTIONS}
          // A private profile always means followers only, whatever is stored.
          value={privacy?.isPrivate !== false ? "followers" : privacy.storyVisibility}
          disabled={privacy?.isPrivate !== false}
          onChange={(storyVisibility) => void save({ storyVisibility })}
        />
        <View style={styles.separator} />
        <Choice
          title="Wer sieht meine Beiträge"
          options={VISIBILITY_OPTIONS}
          value={privacy?.isPrivate !== false ? "followers" : privacy.postVisibility}
          disabled={privacy?.isPrivate !== false}
          onChange={(postVisibility) => void save({ postVisibility })}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="person-add-outline"
          title="Follower-Anfragen"
          subtitle={requestCount > 0 ? `${requestCount} offen` : "Keine offenen Anfragen"}
          onPress={() => router.push("/follow-requests")}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="trash-outline"
          title="Konto löschen"
          subtitle="Endgültig, mit allen Daten"
          onPress={() => router.push("/delete-account")}
        />
      </View>
      <Text style={styles.footnote}>
        {privacy?.isPrivate !== false
          ? "Dein Profil ist privat: Storys und Beiträge sehen nur bestätigte Follower. Die beiden Auswahlen gelten erst, wenn dein Profil öffentlich ist."
          : "„Alle“ heisst: jeder angemeldete Nutzer kann es über dein Profil sehen. In fremden Feeds erscheinst du trotzdem nur bei Leuten, die dir folgen."}
        {" "}Wenn du dein Profil öffentlich machst, werden offene Follower-Anfragen automatisch bestätigt. Wenn du es
        wieder privat machst, bleiben deine bisherigen Follower.
      </Text>

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Markieren</Text>
      <View style={styles.card}>
        <Choice
          title="Wer darf mich markieren"
          options={TAG_OPTIONS}
          value={tags?.tagPermission ?? "everyone"}
          disabled={tags === null}
          onChange={(tagPermission) => void saveTags({ tagPermission })}
        />
        <View style={styles.separator} />
        <View style={styles.row}>
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Mitteilung bei Markierungen</Text>
          </View>
          <Switch
            value={tags?.tagNotifications ?? true}
            onValueChange={(tagNotifications) => void saveTags({ tagNotifications })}
            disabled={tags === null}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel="Mitteilung bei Markierungen"
          />
        </View>
        <View style={styles.separator} />
        <View style={styles.row}>
          <Ionicons name="chatbubble-outline" size={22} color={colors.text} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Markierungen im Chat</Text>
            <Text style={styles.rowSubtitle}>„… hat dich markiert“ als Nachricht</Text>
          </View>
          <Switch
            value={tags?.tagChatMessages ?? true}
            onValueChange={(tagChatMessages) => void saveTags({ tagChatMessages })}
            disabled={tags === null}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel="Markierungen im Chat"
          />
        </View>
      </View>
      <Text style={styles.footnote}>
        „Verbindungen“ heisst: Leute, denen du folgst oder die dir folgen. Markieren können dich ausserdem nur Leute,
        mit denen du verbunden bist oder deren Inhalt öffentlich ist; höchstens 10 Personen pro Beitrag.
      </Text>

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Darstellung</Text>
      <View style={styles.card}>
        <Choice
          title="Erscheinungsbild"
          options={APPEARANCE_OPTIONS}
          value={preference}
          onChange={setPreference}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="apps-outline"
          title="App-Icon"
          subtitle={appIconLabel ?? "…"}
          onPress={() => router.push("/app-icon")}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="information-circle-outline"
          title="Einführung nochmal ansehen"
          subtitle="Kurzer Überblick über die App"
          onPress={() => router.push({ pathname: "/onboarding", params: { replay: "1" } })}
        />
      </View>

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Privatsphäre</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="aperture-outline"
          title="Story verbergen vor"
          subtitle={countLabel(counts.stories)}
          onPress={() => open("stories")}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="images-outline"
          title="Beiträge verbergen vor"
          subtitle={countLabel(counts.posts)}
          onPress={() => open("posts")}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="hand-left-outline"
          title="Blockierte Konten"
          subtitle="Ansehen und entblocken"
          onPress={() => router.push("/blocked-accounts")}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="flag-outline"
          title="Meine Meldungen"
          subtitle="Stand deiner Meldungen"
          onPress={() => router.push("/my-reports")}
        />
      </View>
      <Text style={styles.footnote}>
        Verborgene Personen sehen deine Storys bzw. Workout-Beiträge und deinen Kalender nicht mehr. Sie
        erfahren davon nichts.
      </Text>

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Datenschutz</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="bar-chart-outline" size={22} color={colors.text} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Anonyme Nutzungsstatistik</Text>
            <Text style={styles.rowSubtitle}>Hilft uns zu sehen, welche Bereiche genutzt werden</Text>
          </View>
          <Switch
            value={usageEnabled}
            onValueChange={(value) => void setUsageEnabled(value)}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel="Anonyme Nutzungsstatistik"
          />
        </View>
      </View>
      <Text style={styles.footnote}>
        Gezählt wird nur, wie oft ein Bereich der App geöffnet wird (zum Beispiel Feed oder Chats), als Tagessumme
        für alle Nutzer zusammen. Dabei wird weder dein Konto noch dein Gerät gespeichert, und keine Inhalte. Die
        Einstellung gilt nur auf diesem Gerät.
      </Text>

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Rechtliches</Text>
      <View style={styles.card}>
        {(legal.status ?? []).map((doc, index) => (
          <View key={doc.documentId}>
            {index > 0 && <View style={styles.separator} />}
            <SettingsRow
              icon="document-text-outline"
              title={LEGAL_TYPE_LABELS[doc.docType]}
              subtitle={`Version ${doc.version} · ${
                doc.confirmedAt !== null
                  ? `${doc.confirmationType === "accept" ? "Akzeptiert" : "Zur Kenntnis genommen"} am ${formatDate(doc.confirmedAt)}`
                  : doc.requiresConfirmation
                    ? "Noch nicht bestätigt"
                    : "Zur Information"
              }`}
              onPress={() => router.push({ pathname: "/legal/[docType]", params: { docType: doc.docType } })}
            />
          </View>
        ))}
        {legal.pending.length > 0 && (
          <>
            <View style={styles.separator} />
            <SettingsRow
              icon="checkmark-circle-outline"
              title="Ausstehende Bestätigungen"
              subtitle={`${legal.pending.length} ${legal.pending.length === 1 ? "Text" : "Texte"} zu bestätigen`}
              onPress={() => router.push("/legal-update")}
            />
          </>
        )}
        {(legal.status ?? []).length === 0 && (
          <SettingsRow
            icon="document-text-outline"
            title="Datenschutzerklärung"
            subtitle="Lesen"
            onPress={() => router.push({ pathname: "/legal/[docType]", params: { docType: "privacy" } })}
          />
        )}
      </View>
      <Text style={styles.footnote}>Ältere Versionen findest du am Ende des jeweiligen Texts.</Text>

      <View style={styles.signOut}>
        <Button label="Abmelden" variant="secondary" onPress={confirmSignOut} />
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
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "600",
      paddingHorizontal: spacing.sm,
    },
    sectionSpacing: {
      marginTop: spacing.md,
    },
    card: {
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
    },
    pressed: {
      backgroundColor: colors.surfaceRaised,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
    rowSubtitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: spacing.md + 22 + spacing.md,
      backgroundColor: colors.border,
    },
    choiceRow: {
      gap: spacing.sm,
      padding: spacing.md,
    },
    disabled: {
      opacity: 0.45,
    },
    signOut: {
      marginTop: spacing.lg,
    },
    footnote: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      lineHeight: 19,
      paddingHorizontal: spacing.sm,
    },
  }),
);
