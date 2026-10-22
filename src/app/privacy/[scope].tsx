import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { ProfileRow } from "@/components/profile-row";
import { fontSize, radius, spacing } from "@/constants/theme";
import { listFollowers, listHiddenUserIds, setHiddenFrom } from "@/lib/privacyRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { AudienceScope } from "@/types/database";
import type { PublicProfile } from "@/types/social";
import { useTrackScreen } from "@/lib/usage";

const TITLES: Record<AudienceScope, string> = {
  stories: "Story verbergen vor",
  posts: "Beiträge verbergen vor",
};

/** Followers with a switch each: on = this person can't see my stories / posts. */
export default function HiddenAudienceScreen() {
  useTrackScreen("screen_privacy");
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ scope: string }>();
  const scope: AudienceScope = params.scope === "posts" ? "posts" : "stories";

  const [followers, setFollowers] = useState<PublicProfile[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listFollowers(), listHiddenUserIds(scope)])
      .then(([people, hiddenIds]) => {
        setFollowers(people);
        setHidden(hiddenIds);
      })
      .catch(() => setError("Follower konnten nicht geladen werden."));
  }, [scope]);

  async function toggle(person: PublicProfile, hide: boolean) {
    const update = (value: boolean) =>
      setHidden((prev) => {
        const next = new Set(prev);
        if (value) next.add(person.id);
        else next.delete(person.id);
        return next;
      });
    update(hide); // optimistic
    setError(null);
    try {
      await setHiddenFrom(person.id, scope, hide);
    } catch {
      update(!hide);
      setError("Einstellung konnte nicht gespeichert werden.");
    }
  }

  const term = query.trim().toLowerCase();
  const visible = (followers ?? []).filter((p) => p.username.includes(term));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: TITLES[scope] }} />
      <TextInput
        keyboardAppearance={scheme}
        value={query}
        onChangeText={setQuery}
        placeholder="Follower suchen"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
        accessibilityLabel="Follower suchen"
      />
      {error !== null && <Text style={styles.error}>{error}</Text>}
      {followers === null && error === null ? (
        <ActivityIndicator style={styles.loader} color={colors.accent} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text style={styles.hint}>
              {scope === "stories"
                ? "Eingeschaltete Personen sehen deine Storys nicht."
                : "Eingeschaltete Personen sehen deine Workout-Beiträge und deinen Kalender nicht."}
            </Text>
          }
          renderItem={({ item }) => (
            <ProfileRow
              profile={item}
              accessory={
                <Switch
                  value={hidden.has(item.id)}
                  onValueChange={(value) => void toggle(item, value)}
                  trackColor={{ true: colors.accent, false: colors.surfaceRaised }}
                  accessibilityLabel={`Vor @${item.username} verbergen`}
                />
              }
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {(followers ?? []).length === 0 ? "Dir folgt noch niemand." : "Niemand gefunden."}
            </Text>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    search: {
      margin: spacing.md,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: fontSize.md,
    },
    loader: {
      marginTop: spacing.xl,
    },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    empty: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
      padding: spacing.xl,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
    },
  }),
);
