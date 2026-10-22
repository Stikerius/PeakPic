import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { FollowButton } from "@/components/follow-button";
import { useReport } from "@/components/moderation/report-provider";
import { Avatar } from "@/components/ui/avatar";
import { STORY_RING_INSET, StoryRing } from "@/components/stories/story-ring";
import { HighlightsRow } from "@/components/profile/highlights-row";
import { PlanSummary } from "@/components/profile/plan-summary";
import { PostGrid } from "@/components/profile/post-grid";
import { FlameIcon } from "@/components/streak/flame-icon";
import { MonthCalendar } from "@/components/streak/month-calendar";
import { Button } from "@/components/ui/button";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import { useBlockUser } from "@/hooks/use-block-user";
import { showActionSheet } from "@/lib/actionSheet";
import { getOrCreateDirectConversation } from "@/lib/chatRepo";
import { describeError } from "@/lib/errors";
import { listHighlights, type Highlight } from "@/lib/highlightRepo";
import { fetchUserStoryGroup } from "@/lib/storyRepo";
import {
  addMonths,
  computeStreakStatsFromDays,
  flameTier,
  parseDayKey,
  runLengthByDay,
  toDayKey,
  type DayKey,
} from "@/lib/streak";
import { adoptPlan, fetchPlansOf, type TrainingPlan } from "@/lib/planRepo";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";
import {
  fetchProfileGrid,
  fetchUserProfile,
  fetchUserWorkoutDays,
  type PostThumbnail,
  type UserProfileSummary,
} from "@/lib/userProfileRepo";
import { track, useTrackScreen } from "@/lib/usage";

const AVATAR_SIZE = 88;

type Content = {
  days: DayKey[];
  sharedDays: ReadonlySet<DayKey>;
  restDays: DayKey[];
  posts: PostThumbnail[];
  highlights: Highlight[];
  /** Active stories I may see (followed, or public with "everyone"). */
  hasStories: boolean;
  storiesUnseen: boolean;
};

type StatProps = { value: number; label: string; icon?: ReactNode; onPress?: () => void };

function Stat({ value, label, icon, onPress }: StatProps) {
  const styles = useStyles();
  const content = (
    <>
      <View style={styles.statValueRow}>
        {icon}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  return onPress !== undefined ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${value} ${label}`} style={styles.stat}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.stat}>{content}</View>
  );
}

export default function UserProfileScreen() {
  useTrackScreen("screen_user_profile");
  const { colors } = useTheme();
  const styles = useStyles();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { openReport } = useReport();
  const blockUser = useBlockUser();

  const [summary, setSummary] = useState<UserProfileSummary | null | undefined>(undefined);
  const [content, setContent] = useState<Content | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Plans have their own visibility (followers / everyone), independent of posts and stories.
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const myId = useSession().session?.user.id ?? null;

  const today = toDayKey(new Date());
  const { year: currentYear, month: currentMonth } = parseDayKey(today);
  const [visibleMonth, setVisibleMonth] = useState({ year: currentYear, month: currentMonth });

  async function load() {
    fetchPlansOf(userId)
      .then(setPlans)
      .catch(() => setPlans([]));
    try {
      const result = await fetchUserProfile(userId);
      setSummary(result);
      if (result !== null && (result.canSeePosts || result.canSeeStories)) {
        // Only ask for what the settings allow; RLS enforces the same rules anyway.
        const [days, posts, highlights, stories] = await Promise.all([
          result.canSeePosts ? fetchUserWorkoutDays(userId) : Promise.resolve({ days: [], shared: [], restDays: [] }),
          result.canSeePosts ? fetchProfileGrid(userId) : Promise.resolve([]),
          result.canSeeStories ? listHighlights(userId) : Promise.resolve([]),
          result.canSeeStories ? fetchUserStoryGroup(userId) : Promise.resolve(null),
        ]);
        setContent({
          days: days.days,
          sharedDays: new Set(days.shared.map((s) => s.day)),
          restDays: days.restDays,
          posts,
          highlights,
          hasStories: stories !== null,
          storiesUnseen: stories?.hasUnseen ?? false,
        });
      } else {
        setContent(null);
      }
    } catch {
      setError("Profil konnte nicht geladen werden.");
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);

  function adopt(plan: TrainingPlan, activate: boolean) {
    setAdoptingId(plan.id);
    adoptPlan(plan.id, activate)
      .then(() =>
        Alert.alert("Plan übernommen", activate ? "Der Plan ist jetzt dein aktiver Plan." : "Du findest ihn unter deinen Trainingsplänen.", [
          { text: "OK", style: "cancel" },
          { text: "Zu meinen Plänen", onPress: () => router.push("/plan-edit") },
        ]),
      )
      .catch((adoptError: unknown) => Alert.alert("Hat nicht geklappt", describeError(adoptError)))
      .finally(() => setAdoptingId(null));
  }

  function confirmAdopt(plan: TrainingPlan) {
    track("plan_adopt_opened");
    Alert.alert(
      `„${plan.name}“ übernehmen?`,
      "Du bekommst eine eigene Kopie mit allen Tagen und Übungen, ohne Zielgewichte und Notizen. Sie ist nur für dich sichtbar; Änderungen am Original wirken sich nicht aus. Beim Aktivieren beginnt die Reihenfolge bei Tag 1 und dein Plan-Streak startet neu.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Übernehmen", onPress: () => adopt(plan, false) },
        { text: "Übernehmen und aktivieren", onPress: () => adopt(plan, true) },
      ],
    );
  }

  async function openChat() {
    if (chatBusy) return;
    setChatBusy(true);
    try {
      const conversationId = await getOrCreateDirectConversation(userId);
      router.push({ pathname: "/chats/[conversationId]", params: { conversationId } });
    } catch (chatError) {
      setError(describeError(chatError));
    } finally {
      setChatBusy(false);
    }
  }

  if (summary === undefined) {
    return (
      <View style={styles.centered}>
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }
  if (summary === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Dieses Profil gibt es nicht mehr.</Text>
      </View>
    );
  }

  const { profile } = summary;
  const stats = computeStreakStatsFromDays(content?.days ?? [], today, content?.restDays ?? []);
  const runLengths = runLengthByDay(stats.trainingDays, new Set(content?.restDays ?? []));
  const canGoNext = visibleMonth.year * 12 + visibleMonth.month < currentYear * 12 + currentMonth;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: profile.username,
          headerRight: () => (
            <Pressable
              onPress={() =>
                showActionSheet(profile.displayName, [
                  {
                    label: "Profil melden",
                    destructive: true,
                    onPress: () => openReport({ targetType: "profile", targetId: profile.id }),
                  },
                  { label: "Blockieren", destructive: true, onPress: () => blockUser(profile, () => router.back()) },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel="Weitere Optionen"
              hitSlop={spacing.sm}
              style={styles.headerButton}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.header}>
        {content?.hasStories ? (
          <Pressable
            onPress={() => router.push({ pathname: "/stories/[userId]", params: { userId, only: "1" } })}
            accessibilityRole="button"
            accessibilityLabel={`Story von ${profile.username} ansehen`}
          >
            <StoryRing size={AVATAR_SIZE + 2 * STORY_RING_INSET} state={content.storiesUnseen ? "unseen" : "seen"}>
              <Avatar uri={profile.avatarUrl} username={profile.username} size={AVATAR_SIZE} />
            </StoryRing>
          </Pressable>
        ) : (
          <Avatar uri={profile.avatarUrl} username={profile.username} size={AVATAR_SIZE} />
        )}
        <View style={styles.names}>
          <Text style={styles.displayName}>{profile.displayName}</Text>
          <Text style={styles.handle}>@{profile.username}</Text>
        </View>
        <View style={styles.badges}>
          {summary.isPrivate && (
            <View style={styles.badge}>
              <Ionicons name="lock-closed" size={11} color={colors.textSecondary} />
              <Text style={styles.badgeText}>Privat</Text>
            </View>
          )}
          {summary.followsMe && <Text style={styles.followsYou}>Folgt dir</Text>}
        </View>
      </View>

      <View style={styles.stats}>
        <Stat
          value={stats.current}
          label="Streak"
          icon={
            stats.current > 0 ? (
              <FlameIcon tier={flameTier(stats.current)} baseSize={18} />
            ) : undefined
          }
        />
        <Stat value={stats.longest} label="Rekord" />
        <Stat
          value={summary.followerCount}
          label="Follower"
          onPress={
            summary.canSeeLists
              ? () => router.push({ pathname: "/follows/[userId]", params: { userId, list: "followers" } })
              : undefined
          }
        />
        <Stat
          value={summary.followingCount}
          label="Folgt"
          onPress={
            summary.canSeeLists
              ? () => router.push({ pathname: "/follows/[userId]", params: { userId, list: "following" } })
              : undefined
          }
        />
      </View>

      <View style={styles.actions}>
        <View style={styles.action}>
          <FollowButton
            userId={userId}
            username={profile.username}
            status={summary.followStatus}
            size="md"
            onChange={() => void load()}
          />
        </View>
        {summary.followStatus === "accepted" && (
          <Button
            label="Nachricht"
            variant="secondary"
            onPress={() => void openChat()}
            loading={chatBusy}
            style={styles.action}
          />
        )}
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {plans.length > 0 && (
        <View style={styles.plans}>
          {plans.map((plan) => (
            <PlanSummary
              key={plan.id}
              plan={plan}
              busy={adoptingId === plan.id}
              onAdopt={plan.allowAdopt && plan.userId !== myId ? () => confirmAdopt(plan) : undefined}
              onReport={plan.userId !== myId ? () => openReport({ targetType: "plan", targetId: plan.id }) : undefined}
            />
          ))}
        </View>
      )}

      {!summary.canSeePosts && !summary.canSeeStories ? (
        <View style={styles.locked}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textSecondary} />
          <Text style={styles.lockedTitle}>Dieses Profil ist privat</Text>
          <Text style={styles.muted}>
            {summary.followStatus === "pending"
              ? `Deine Anfrage ist gesendet. Sobald @${profile.username} sie bestätigt, siehst du Storys, Kalender und Beiträge.`
              : `Folge @${profile.username}, um Storys, Kalender und Beiträge zu sehen.`}
          </Text>
        </View>
      ) : content === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <HighlightsRow highlights={content.highlights} editable={false} />

          {!summary.canSeePosts ? (
            <View style={styles.locked}>
              <Ionicons name="images-outline" size={32} color={colors.textSecondary} />
              <Text style={styles.muted}>Kalender und Beiträge von @{profile.username} sehen nur Follower.</Text>
            </View>
          ) : (
            <>
              <View style={styles.calendar}>
                <MonthCalendar
                  year={visibleMonth.year}
                  month={visibleMonth.month}
                  today={today}
                  runLengths={runLengths}
                  sharedDays={content.sharedDays}
                  restDays={new Set(content.restDays)}
                  canGoNext={canGoNext}
                  onPrev={() => setVisibleMonth((m) => addMonths(m.year, m.month, -1))}
                  onNext={() => setVisibleMonth((m) => addMonths(m.year, m.month, 1))}
                  onSelectDay={(day) =>
                    router.push({ pathname: "/day/[date]", params: { date: day, userId } })
                  }
                />
              </View>

              <Text style={styles.sectionTitle}>Beiträge</Text>
              <PostGrid posts={content.posts} emptyText="Noch keine Beiträge sichtbar." />
            </>
          )}
        </>
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
      paddingBottom: spacing.xl,
      gap: spacing.md,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    header: {
      alignItems: "center",
      gap: spacing.xs,
      paddingTop: spacing.lg,
    },
    username: {
      marginTop: spacing.sm,
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: "700",
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
    handle: {
      ...typography.body,
      color: colors.textSecondary,
    },
    badges: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    badgeText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    followsYou: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    stats: {
      flexDirection: "row",
      marginHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    stat: {
      flex: 1,
      alignItems: "center",
      gap: 2,
    },
    statValueRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    statValue: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "800",
    },
    statLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    action: {
      flex: 1,
    },
    locked: {
      alignItems: "center",
      gap: spacing.sm,
      margin: spacing.md,
      padding: spacing.xl,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    lockedTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
    calendar: {
      paddingHorizontal: spacing.md,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
      paddingHorizontal: spacing.md,
    },
    muted: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.sm,
      textAlign: "center",
      paddingHorizontal: spacing.md,
    },
    plans: {
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    headerButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
