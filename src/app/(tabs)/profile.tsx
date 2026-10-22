import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { HighlightsRow } from "@/components/profile/highlights-row";
import { PlanSummary } from "@/components/profile/plan-summary";
import { PostGrid } from "@/components/profile/post-grid";
import { FlameIcon } from "@/components/streak/flame-icon";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import { useFollowRequestCount } from "@/hooks/use-follow-requests";
import { useWorkoutDays } from "@/hooks/use-workout-days";
import { describeError } from "@/lib/errors";
import { onAppEvent } from "@/lib/events";
import { listMyHighlights, type Highlight } from "@/lib/highlightRepo";
import { fetchMyPlan, fetchPlanProofs, type TrainingPlan } from "@/lib/planRepo";
import { getMyProfile, updateMyAvatar, type Profile } from "@/lib/profileRepo";
import { useSession } from "@/lib/session";
import { fetchFollowCounts } from "@/lib/socialRepo";
import {
  computeStreakStatsFromDays,
  flameTier,
  nextPlanDayIndex,
  toDayKey,
  type PlanProof,
} from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import { fetchProfileGrid, type PostThumbnail } from "@/lib/userProfileRepo";
import { useTrackScreen } from "@/lib/usage";

const AVATAR_SIZE = 112;

export default function ProfileScreen() {
  useTrackScreen("screen_profile");
  const { colors } = useTheme();
  const styles = useStyles();
  // Session can briefly be null while signing out, before the route guard unmounts us.
  const email = useSession().session?.user.email;
  const myId = useSession().session?.user.id ?? null;
  const { days, restDays } = useWorkoutDays();
  const [planProofs, setPlanProofs] = useState<PlanProof[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [posts, setPosts] = useState<PostThumbnail[] | null>(null);
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);
  const requestCount = useFollowRequestCount();
  // Bumped when posts or highlights change elsewhere, to reload them.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const unsubscribers = [
      onAppEvent("postCreated", bump),
      onAppEvent("postDeleted", bump),
      onAppEvent("highlightsChanged", bump),
      onAppEvent("followChanged", bump),
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
          const [mine, grid, followCounts, myPlan] = await Promise.all([
            listMyHighlights(),
            fetchProfileGrid(result.id),
            fetchFollowCounts(result.id),
            fetchMyPlan().catch(() => null),
          ]);
          if (!active) return;
          setPlan(myPlan);
          setPlanProofs(await fetchPlanProofs().catch(() => []));
          setHighlights(mine);
          setPosts(grid);
          setCounts(followCounts);
        })
        .catch(() => {
          if (active) setError("Profil konnte nicht geladen werden.");
        });
      return () => {
        active = false;
      };
    }, [version]),
  );

  const stats = computeStreakStatsFromDays(days, toDayKey(new Date()), restDays);

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

  function openList(list: "followers" | "following") {
    if (profile !== null) router.push({ pathname: "/follows/[userId]", params: { userId: profile.id, list } });
  }

  if (profile === null) {
    return (
      <View style={styles.centered}>
        {error !== null ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} />
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
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <Ionicons name="camera" size={16} color={colors.onAccent} />
              )}
            </View>
          </Pressable>
          <View style={styles.names}>
            <Text style={styles.displayName}>{profile.displayName}</Text>
            <Text style={styles.username}>@{profile.username}</Text>
          </View>
          {email !== undefined && <Text style={styles.email}>{email}</Text>}
          <View style={styles.followRow}>
            <Pressable onPress={() => openList("followers")} accessibilityRole="button" hitSlop={spacing.xs}>
              <Text style={styles.followText}>
                <Text style={styles.followCount}>{counts?.followers ?? "–"}</Text> Follower
              </Text>
            </Pressable>
            <Pressable onPress={() => openList("following")} accessibilityRole="button" hitSlop={spacing.xs}>
              <Text style={styles.followText}>
                <Text style={styles.followCount}>{counts?.following ?? "–"}</Text> Folge ich
              </Text>
            </Pressable>
          </View>
          {requestCount > 0 && (
            <Pressable
              onPress={() => router.push("/follow-requests")}
              accessibilityRole="button"
              style={styles.requestsChip}
            >
              <Ionicons name="person-add" size={14} color={colors.onAccent} />
              <Text style={styles.requestsText}>
                {requestCount} {requestCount === 1 ? "Follower-Anfrage" : "Follower-Anfragen"}
              </Text>
            </Pressable>
          )}
          <Button
            label="Profil bearbeiten"
            variant="secondary"
            size="sm"
            onPress={() => router.push("/profile-edit")}
            style={styles.editButton}
          />
        </View>
      </View>

      <HighlightsRow highlights={highlights} editable />

      {plan !== null && (
        <View style={styles.padded}>
          <PlanSummary
            plan={plan}
            nextIndex={nextPlanDayIndex(
              plan.days.map((d) => d.id),
              planProofs,
            )}
          />
        </View>
      )}

      <View style={[styles.padded, styles.section]}>
        {error !== null && <Text style={styles.error}>{error}</Text>}

        <View style={styles.stats}>
          <View style={styles.stat}>
            <View style={styles.statIcon}>
              {stats.current > 0 ? (
                <FlameIcon tier={flameTier(stats.current)} baseSize={28} />
              ) : (
                <Ionicons name="flame-outline" size={28} color={colors.textSecondary} />
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
              <Ionicons name="barbell" size={28} color={colors.accent} />
            </View>
            <Text style={styles.statValue}>{stats.trainingDays.size}</Text>
            <Text style={styles.statLabel}>Trainingstage</Text>
          </View>
        </View>
      </View>

      {myId !== null && (
        <View style={styles.activitiesCard}>
          <Pressable
            onPress={() => router.push({ pathname: "/activities/[userId]", params: { userId: myId } })}
            accessibilityRole="button"
            accessibilityLabel="Aktivitäten: aufgezeichnete Trainings"
            style={({ pressed }) => [styles.activitiesRow, pressed && styles.activitiesPressed]}
          >
            <Ionicons name="barbell-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.activitiesText}>Aktivitäten</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
          <Divider />
          <Pressable
            onPress={() => router.push({ pathname: "/stats/[userId]", params: { userId: myId } })}
            accessibilityRole="button"
            accessibilityLabel="Statistik: Trainings, Zeit, Streak und Übungen"
            style={({ pressed }) => [styles.activitiesRow, pressed && styles.activitiesPressed]}
          >
            <Ionicons name="bar-chart-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.activitiesText}>Statistik</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      )}

      <Text style={[styles.sectionTitle, styles.padded]}>Beiträge</Text>
      {posts === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <PostGrid posts={posts} emptyText="Noch keine Beiträge im Profil. Teile ein Workout im Feed." />
      )}
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
      paddingVertical: spacing.md,
      gap: spacing.lg,
    },
    activitiesCard: {
      marginHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    activitiesRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
    },
    activitiesPressed: {
      backgroundColor: colors.surfaceRaised,
    },
    activitiesText: {
      ...typography.body,
      flex: 1,
      color: colors.text,
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
      backgroundColor: colors.accent,
      borderWidth: 3,
      borderColor: colors.background,
    },
    names: {
      marginTop: spacing.sm,
      alignItems: "center",
    },
    displayName: {
      ...typography.title,
      color: colors.text,
      textAlign: "center",
    },
    username: {
      ...typography.body,
      color: colors.textSecondary,
    },
    editButton: {
      marginTop: spacing.ms,
    },
    followRow: {
      flexDirection: "row",
      gap: spacing.lg,
      marginTop: spacing.sm,
    },
    followText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
    },
    followCount: {
      color: colors.text,
      fontWeight: "800",
    },
    requestsChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.full,
      backgroundColor: colors.accent,
    },
    requestsText: {
      color: colors.onAccent,
      fontSize: fontSize.sm,
      fontWeight: "700",
    },
    email: {
      color: colors.textSecondary,
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
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: "center",
    },
  }),
);
