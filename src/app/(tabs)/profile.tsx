import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
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
import { FlameIcon } from "@/components/streak/flame-icon";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useWorkoutDays } from "@/hooks/use-workout-days";
import { signOut } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { getMyProfile, updateMyAvatar, type Profile } from "@/lib/profileRepo";
import { useSession } from "@/lib/session";
import { computeStreakStatsFromDays, flameTier, toDayKey } from "@/lib/streak";

const AVATAR_SIZE = 112;

export default function ProfileScreen() {
  // Session can briefly be null while signing out, before the route guard unmounts us.
  const email = useSession().session?.user.email;
  const { days } = useWorkoutDays();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMyProfile()
        .then((result) => {
          if (!active) return;
          setProfile(result);
          setError(null);
        })
        .catch(() => {
          if (active) setError("Profil konnte nicht geladen werden.");
        });
      return () => {
        active = false;
      };
    }, []),
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

      <Button label="Abmelden" variant="secondary" onPress={confirmSignOut} />
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
    gap: spacing.lg,
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
