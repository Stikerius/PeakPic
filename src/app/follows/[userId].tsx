import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { FollowButton } from "@/components/follow-button";
import { ProfileRow } from "@/components/profile-row";
import { fontSize, radius, spacing } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { useSession } from "@/lib/session";
import {
  getMyFollowStatuses,
  listFollowersOf,
  listFollowingOf,
  removeFollower,
  type FollowStatus,
} from "@/lib/socialRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { fetchUserProfile } from "@/lib/userProfileRepo";
import type { PublicProfile } from "@/types/social";

type ListKind = "followers" | "following";

/**
 * Followers or followed people of a user, with search. Shown for my own profile, public
 * profiles and people I follow; otherwise only the counts are visible (RLS agrees).
 */
export default function FollowListScreen() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { userId, list } = useLocalSearchParams<{ userId: string; list: ListKind }>();
  const myId = useSession().session?.user.id;
  const isMine = userId === myId;
  const openProfile = useOpenProfile();

  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [statuses, setStatuses] = useState<Map<string, FollowStatus>>(new Map());
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isMine) {
        const summary = await fetchUserProfile(userId);
        if (summary === null || !summary.canSeeLists) {
          if (active) setLocked(true);
          return;
        }
      }
      const result = list === "followers" ? await listFollowersOf(userId) : await listFollowingOf(userId);
      const mine = await getMyFollowStatuses(result.map((p) => p.id));
      if (!active) return;
      setPeople(result);
      setStatuses(mine);
    })().catch((loadError: unknown) => {
      if (active) setError(describeError(loadError));
    });
    return () => {
      active = false;
    };
  }, [userId, list, isMine]);

  function confirmRemove(person: PublicProfile) {
    Alert.alert(`@${person.username} entfernen?`, "Die Person folgt dir danach nicht mehr. Sie wird nicht benachrichtigt.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Entfernen",
        style: "destructive",
        onPress: () => {
          removeFollower(person.id)
            .then(() => {
              setPeople((prev) => prev?.filter((p) => p.id !== person.id) ?? prev);
              emitAppEvent("followChanged", undefined);
            })
            .catch((removeError: unknown) => Alert.alert("Entfernen fehlgeschlagen", describeError(removeError)));
        },
      },
    ]);
  }

  function setStatus(id: string, status: FollowStatus) {
    setStatuses((prev) => new Map(prev).set(id, status));
    // In my own following list, unfollowing removes the person.
    if (isMine && list === "following" && status === "none") {
      setPeople((prev) => prev?.filter((p) => p.id !== id) ?? prev);
    }
  }

  const term = query.trim().toLowerCase();
  const visible = (people ?? []).filter((p) => p.username.includes(term));
  const title = list === "followers" ? "Follower" : "Folge ich";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      {locked ? (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textSecondary} />
          <Text style={styles.muted}>Dieses Profil ist privat. Die Liste sehen nur bestätigte Follower.</Text>
        </View>
      ) : people === null ? (
        <View style={styles.centered}>
          {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
        </View>
      ) : (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              keyboardAppearance={scheme}
              value={query}
              onChangeText={setQuery}
              placeholder="Suchen"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
              accessibilityLabel={`${title} durchsuchen`}
            />
          </View>
          <FlatList
            data={visible}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
              <ProfileRow
                profile={item}
                onPress={() => openProfile(item.id)}
                accessory={
                  item.id === myId ? null : (
                    <View style={styles.actions}>
                      <FollowButton
                        userId={item.id}
                        username={item.username}
                        status={statuses.get(item.id) ?? "none"}
                        onChange={(status) => setStatus(item.id, status)}
                      />
                      {isMine && list === "followers" && (
                        <Pressable
                          onPress={() => confirmRemove(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`@${item.username} als Follower entfernen`}
                          hitSlop={spacing.sm}
                          style={styles.removeButton}
                        >
                          <Ionicons name="close" size={18} color={colors.textSecondary} />
                        </Pressable>
                      )}
                    </View>
                  )
                }
              />
            )}
            ListEmptyComponent={
              <Text style={[styles.muted, styles.padded]}>
                {term.length > 0 ? "Niemand gefunden." : list === "followers" ? "Noch keine Follower." : "Folgt noch niemandem."}
              </Text>
            }
          />
        </>
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
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      margin: spacing.md,
      paddingHorizontal: spacing.md,
      minHeight: 44,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    removeButton: {
      padding: spacing.xs,
    },
    muted: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
    },
    padded: {
      padding: spacing.lg,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);
