import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { Button } from "@/components/button";
import { appIconForNativeName } from "@/constants/appIcons";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useFollowRequestCount } from "@/hooks/use-follow-requests";
import { loadAppIconLibrary } from "@/lib/appIcon";
import { signOut } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { listHiddenUserIds } from "@/lib/privacyRepo";
import {
  getMyProfile,
  getMyTagSettings,
  updatePrivacy,
  updateTagSettings,
  type PrivacySettings,
  type TagSettings,
} from "@/lib/profileRepo";
import type { AudienceScope, TagPermission, Visibility } from "@/types/database";

type RowProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
};

function SettingsRow({ icon, title, subtitle, onPress }: RowProps) {
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
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
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

/** Segmented choice ("Alle" / "Nur Follower", "Wer darf mich markieren", …). */
function Choice<T extends string>({ title, value, options, disabled = false, onChange }: ChoiceProps<T>) {
  const shown = value;
  return (
    <View style={[styles.choiceRow, disabled && styles.disabled]}>
      <Text style={styles.rowTitle}>{title}</Text>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: shown === option.value, disabled }}
            style={[styles.segment, shown === option.value && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, shown === option.value && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "everyone", label: "Alle" },
  { value: "followers", label: "Nur Follower" },
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
  const [counts, setCounts] = useState<Partial<Record<AudienceScope, number>>>({});
  const [appIconLabel, setAppIconLabel] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [tags, setTags] = useState<TagSettings | null>(null);
  const requestCount = useFollowRequestCount();

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
            trackColor={{ true: colors.primary, false: colors.border }}
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
            trackColor={{ true: colors.primary, false: colors.border }}
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
            trackColor={{ true: colors.primary, false: colors.border }}
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
        <SettingsRow
          icon="apps-outline"
          title="App-Icon"
          subtitle={appIconLabel ?? "…"}
          onPress={() => router.push("/app-icon")}
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
      </View>
      <Text style={styles.footnote}>
        Verborgene Personen sehen deine Storys bzw. Workout-Beiträge und deinen Kalender nicht mehr. Sie
        erfahren davon nichts.
      </Text>

      <View style={styles.signOut}>
        <Button label="Abmelden" variant="secondary" onPress={confirmSignOut} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
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
    backgroundColor: colors.surfaceElevated,
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
    color: colors.textMuted,
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
  segments: {
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: colors.text,
  },
  signOut: {
    marginTop: spacing.lg,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 19,
    paddingHorizontal: spacing.sm,
  },
});
