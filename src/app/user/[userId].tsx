import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { HighlightsRow } from "@/components/profile/highlights-row";
import { PostGrid } from "@/components/profile/post-grid";
import { FlameIcon } from "@/components/streak/flame-icon";
import { MonthCalendar } from "@/components/streak/month-calendar";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { getOrCreateDirectConversation } from "@/lib/chatRepo";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { listHighlights, type Highlight } from "@/lib/highlightRepo";
import { setFollowing } from "@/lib/socialRepo";
import {
  addMonths,
  computeStreakStatsFromDays,
  flameTier,
  parseDayKey,
  runLengthByDay,
  toDayKey,
  type DayKey,
} from "@/lib/streak";
import {
  fetchProfileGrid,
  fetchUserProfile,
  fetchUserWorkoutDays,
  type PostThumbnail,
  type UserProfileSummary,
} from "@/lib/userProfileRepo";

type Content = { days: DayKey[]; posts: PostThumbnail[]; highlights: Highlight[] };

function Stat({ value, label, icon }: { value: number; label: string; icon?: ReactNode }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        {icon}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [summary, setSummary] = useState<UserProfileSummary | null | undefined>(undefined);
  const [content, setContent] = useState<Content | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = toDayKey(new Date());
  const { year: currentYear, month: currentMonth } = parseDayKey(today);
  const [visibleMonth, setVisibleMonth] = useState({ year: currentYear, month: currentMonth });

  async function load() {
    try {
      const result = await fetchUserProfile(userId);
      setSummary(result);
      if (result?.isFollowing) {
        const [days, posts, highlights] = await Promise.all([
          fetchUserWorkoutDays(userId),
          fetchProfileGrid(userId),
          listHighlights(userId),
        ]);
        setContent({ days, posts, highlights });
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

  async function toggleFollow() {
    if (summary === null || summary === undefined || followBusy) return;
    const follow = !summary.isFollowing;
    setFollowBusy(true);
    setError(null);
    try {
      await setFollowing(userId, follow);
      emitAppEvent("followChanged", undefined);
      await load();
    } catch (followError) {
      setError(describeError(followError));
    } finally {
      setFollowBusy(false);
    }
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
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
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
  const stats = computeStreakStatsFromDays(content?.days ?? [], today);
  const runLengths = runLengthByDay(stats.trainingDays);
  const canGoNext = visibleMonth.year * 12 + visibleMonth.month < currentYear * 12 + currentMonth;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: profile.username }} />

      <View style={styles.header}>
        <Avatar uri={profile.avatarUrl} username={profile.username} size={88} />
        <Text style={styles.username}>@{profile.username}</Text>
        {summary.followsMe && <Text style={styles.followsYou}>Folgt dir</Text>}
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
        <Stat value={summary.followerCount} label="Follower" />
        <Stat value={summary.followingCount} label="Folgt" />
      </View>

      <View style={styles.actions}>
        <Button
          label={summary.isFollowing ? "Gefolgt" : "Folgen"}
          variant={summary.isFollowing ? "secondary" : "primary"}
          onPress={() => void toggleFollow()}
          loading={followBusy}
          style={styles.action}
        />
        {summary.isFollowing && (
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

      {!summary.isFollowing ? (
        <View style={styles.locked}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
          <Text style={styles.lockedTitle}>Workouts sind privat</Text>
          <Text style={styles.muted}>Folge @{profile.username}, um Kalender und Workout-Fotos zu sehen.</Text>
        </View>
      ) : content === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          <HighlightsRow highlights={content.highlights} editable={false} />

          <View style={styles.calendar}>
            <MonthCalendar
              year={visibleMonth.year}
              month={visibleMonth.month}
              today={today}
              runLengths={runLengths}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  followsYou: {
    color: colors.textMuted,
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
    color: colors.textMuted,
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
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
});
