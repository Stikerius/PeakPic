import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { HighlightsRow } from "@/components/profile/highlights-row";
import { PostGrid } from "@/components/profile/post-grid";
import { FlameIcon } from "@/components/streak/flame-icon";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useWorkoutDays } from "@/hooks/use-workout-days";
import { signOut } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { onAppEvent } from "@/lib/events";
import { listMyHighlights, type Highlight } from "@/lib/highlightRepo";
import { getMyProfile, updateMyAvatar, type Profile } from "@/lib/profileRepo";
import { useSession } from "@/lib/session";
import { computeStreakStatsFromDays, flameTier, toDayKey } from "@/lib/streak";
import { fetchProfileGrid, type PostThumbnail } from "@/lib/userProfileRepo";

const AVATAR_SIZE = 112;

export default function ProfileScreen() {
  // Session can briefly be null while signing out, before the route guard unmounts us.
  const email = useSession().session?.user.email;
  const { days } = useWorkoutDays();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [posts, setPosts] = useState<PostThumbnail[] | null>(null);
  // Bumped when posts or highlights change elsewhere, to reload them.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const unsubscribers = [
      onAppEvent("postCreated", bump),
      onAppEvent("postDeleted", bump),
      onAppEvent("highlightsChanged", bump),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMyProfile()
        .then(async (result) => {
          if (!active) return;
          setProfile(result);
          setError(null);
          const [mine, grid] = await Promise.all([listMyHighlights(), fetchProfileGrid(result.id)]);
          if (!active) return;
          setHighlights(mine);
          setPosts(grid);
        })
        .catch(() => {
          if (active) setError("Profil konnte nicht geladen werden.");
        });
      return () => {
        active = false;
      };
    }, [version]),
  );

  const stats = computeStreakStatsFromDays(days, toDayKey(new Date()));

  async function changeAvatar() {
    if (profile === null || uploading) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    const asset = result.assets?.[0];
    if (result.canceled || asset === undefined) return;

    setUploading(true);
    setError(null);
    try {
      setProfile(await updateMyAvatar(asset.uri, profile.avatarPath));
    } catch (uploadError) {
      console.error("[profile] Avatar-Upload fehlgeschlagen:", uploadError);
      setError(`Profilbild konnte nicht hochgeladen werden – ${describeError(uploadError)}`);
    } finally {
      setUploading(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("Abmelden?", "Du kannst dich jederzeit wieder anmelden.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Abmelden", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  if (profile === null) {
    return (
      <View style={styles.centered}>
        {error !== null ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.padded, styles.section]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => void changeAvatar()}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Profilbild ändern"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Avatar uri={profile.avatarUrl} username={profile.username} size={AVATAR_SIZE} />
            <View style={styles.avatarBadge}>
              {uploading ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="camera" size={16} color={colors.text} />
              )}
            </View>
          </Pressable>
          <Text style={styles.username}>@{profile.username}</Text>
          {email !== undefined && <Text style={styles.email}>{email}</Text>}
        </View>
      </View>

      <HighlightsRow highlights={highlights} editable />

      <View style={[styles.padded, styles.section]}>
        {error !== null && <Text style={styles.error}>{error}</Text>}

        <View style={styles.stats}>
          <View style={styles.stat}>
            <View style={styles.statIcon}>
              {stats.current > 0 ? (
                <FlameIcon tier={flameTier(stats.current)} baseSize={28} />
              ) : (
                <Ionicons name="flame-outline" size={28} color={colors.textMuted} />
              )}
            </View>
            <Text style={styles.statValue}>{stats.current}</Text>
            <Text style={styles.statLabel}>Aktueller Streak</Text>
          </View>
          <View style={styles.stat}>
            <View style={styles.statIcon}>
              <Ionicons name="trophy" size={28} color={colors.warning} />
            </View>
            <Text style={styles.statValue}>{stats.longest}</Text>
            <Text style={styles.statLabel}>Längster Streak</Text>
          </View>
          <View style={styles.stat}>
            <View style={styles.statIcon}>
              <Ionicons name="barbell" size={28} color={colors.primary} />
            </View>
            <Text style={styles.statValue}>{stats.trainingDays.size}</Text>
            <Text style={styles.statLabel}>Trainingstage</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.sectionTitle, styles.padded]}>Beiträge</Text>
      {posts === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <PostGrid posts={posts} emptyText="Noch keine Beiträge im Profil. Teile ein Workout im Feed." />
      )}

      <View style={styles.padded}>
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
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  padded: {
    paddingHorizontal: spacing.md,
  },
  section: {
    gap: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
    marginBottom: -spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  avatarBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.background,
  },
  username: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  email: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  stats: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  statIcon: {
    height: 44,
    justifyContent: "flex-end",
  },
  statValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "800",
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
});
