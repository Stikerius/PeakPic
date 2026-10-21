import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { FollowButton } from "@/components/follow-button";
import { ProfileRow } from "@/components/profile-row";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { fontSize, radius, spacing } from "@/constants/theme";
import { getMyFollowStatuses, listFollowing, searchProfiles, type FollowStatus } from "@/lib/socialRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { PublicProfile } from "@/types/social";

const SEARCH_DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [following, setFollowingProfiles] = useState<PublicProfile[]>([]);
  const [statuses, setStatuses] = useState<Map<string, FollowStatus>>(new Map());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openProfile = useOpenProfile();

  useEffect(() => {
    listFollowing()
      .then((profiles) => {
        setFollowingProfiles(profiles);
        setStatuses((prev) => {
          const next = new Map(prev);
          for (const p of profiles) next.set(p.id, "accepted");
          return next;
        });
      })
      .catch(() => setError("Konnte nicht laden, wem du folgst."));
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchProfiles(term)
        .then(async (found) => {
          const foundStatuses = await getMyFollowStatuses(found.map((p) => p.id));
          if (!active) return;
          setResults(found);
          setStatuses((prev) => new Map([...prev, ...foundStatuses]));
        })
        .catch(() => {
          if (active) setError("Suche fehlgeschlagen.");
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  function setStatus(profile: PublicProfile, status: FollowStatus) {
    setStatuses((prev) => new Map(prev).set(profile.id, status));
    if (status === "accepted" && !following.some((p) => p.id === profile.id)) {
      setFollowingProfiles((prev) => [...prev, profile].sort((a, b) => a.username.localeCompare(b.username)));
    }
  }

  const showingSearch = query.trim().length > 0;
  const data = showingSearch ? results : following;

  return (
    <View style={styles.screen}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          keyboardAppearance={scheme}
          value={query}
          onChangeText={setQuery}
          placeholder="Username suchen"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          style={styles.searchInput}
          accessibilityLabel="Username suchen"
        />
        {searching && <ActivityIndicator size="small" color={colors.textSecondary} />}
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={data}
        keyExtractor={(profile) => profile.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          !showingSearch && following.length > 0 ? (
            <Text style={styles.sectionTitle}>Du folgst</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ProfileRow
            profile={item}
            onPress={() => openProfile(item.id)}
            accessory={
              <FollowButton
                userId={item.id}
                username={item.username}
                status={statuses.get(item.id) ?? "none"}
                onChange={(status) => setStatus(item, status)}
              />
            }
          />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {showingSearch
              ? searching
                ? ""
                : "Niemand gefunden."
              : "Such nach Freunden über ihren Username."}
          </Text>
        }
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      margin: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      minHeight: 44,
      color: colors.text,
      fontSize: fontSize.md,
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "600",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
    },
    emptyText: {
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
