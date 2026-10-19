import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { ProfileRow } from "@/components/profile-row";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { emitAppEvent } from "@/lib/events";
import { getFollowingIds, listFollowing, searchProfiles, setFollowing } from "@/lib/socialRepo";
import type { PublicProfile } from "@/types/social";

const SEARCH_DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [following, setFollowingProfiles] = useState<PublicProfile[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getFollowingIds(), listFollowing()])
      .then(([ids, profiles]) => {
        setFollowingIds(new Set(ids));
        setFollowingProfiles(profiles);
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
        .then((found) => {
          if (active) setResults(found);
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

  async function toggleFollow(profile: PublicProfile) {
    const follow = !followingIds.has(profile.id);
    const update = (value: boolean) =>
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (value) next.add(profile.id);
        else next.delete(profile.id);
        return next;
      });

    update(follow); // optimistic
    setError(null);
    try {
      await setFollowing(profile.id, follow);
      if (follow && !following.some((p) => p.id === profile.id)) {
        setFollowingProfiles((prev) =>
          [...prev, profile].sort((a, b) => a.username.localeCompare(b.username)),
        );
      }
      emitAppEvent("followChanged", undefined);
    } catch {
      update(!follow);
      setError(follow ? "Folgen fehlgeschlagen." : "Entfolgen fehlgeschlagen.");
    }
  }

  const showingSearch = query.trim().length > 0;
  const data = showingSearch ? results : following;

  return (
    <View style={styles.screen}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Username suchen"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          style={styles.searchInput}
          accessibilityLabel="Username suchen"
        />
        {searching && <ActivityIndicator size="small" color={colors.textMuted} />}
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
        renderItem={({ item }) => {
          const isFollowing = followingIds.has(item.id);
          return (
            <ProfileRow
              profile={item}
              accessory={
                <Button
                  label={isFollowing ? "Gefolgt" : "Folgen"}
                  variant={isFollowing ? "secondary" : "primary"}
                  size="sm"
                  onPress={() => void toggleFollow(item)}
                />
              }
            />
          );
        }}
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

const styles = StyleSheet.create({
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
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: "600",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
    padding: spacing.xl,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
  },
});
