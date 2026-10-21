import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { ProfileRow } from "@/components/profile-row";
import { Button } from "@/components/ui/button";
import { fontSize, spacing } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { describeError } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
import { listReposts, type Repost } from "@/lib/repostRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { listWorkoutLinks, withdrawWorkoutLink, type WorkoutLink } from "@/lib/workoutLinkRepo";
import type { WorkoutShareStatus } from "@/types/database";

const STATUS_LABELS: Record<WorkoutShareStatus, string> = {
  pending: "Ausstehend",
  accepted: "Angenommen",
  declined: "Abgelehnt",
};

/**
 * For the post owner: status of the workout links and who reposted the post. Reposts can
 * only be viewed here; only the reposter can delete them.
 */
export default function PostLinksScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const openProfile = useOpenProfile();
  const [links, setLinks] = useState<WorkoutLink[] | null>(null);
  const [reposts, setReposts] = useState<Repost[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listWorkoutLinks(postId), listReposts(postId)])
      .then(([foundLinks, foundReposts]) => {
        setLinks(foundLinks);
        setReposts(foundReposts);
      })
      .catch((loadError: unknown) => setError(describeError(loadError)));
  }, [postId]);

  function confirmWithdraw(link: WorkoutLink) {
    Alert.alert("Anfrage zurückziehen?", `@${link.person.username} kann das Workout dann nicht mehr annehmen.`, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Zurückziehen",
        style: "destructive",
        onPress: () => {
          withdrawWorkoutLink(link.id)
            .then(() => setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? prev))
            .catch((withdrawError: unknown) => Alert.alert("Zurückziehen fehlgeschlagen", describeError(withdrawError)));
        },
      },
    ]);
  }

  if (links === null) {
    return (
      <View style={styles.centered}>
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Workout-Verlinkungen</Text>
      {links.length === 0 ? (
        <Text style={styles.muted}>Noch niemand fürs Workout verlinkt. Markiere Leute beim Bearbeiten und wähle „Ja“.</Text>
      ) : (
        links.map((link) => (
          <ProfileRow
            key={link.id}
            profile={link.person}
            onPress={() => openProfile(link.person.id)}
            accessory={
              <View style={styles.accessory}>
                <Text style={[styles.status, link.status === "accepted" && styles.accepted]}>
                  {STATUS_LABELS[link.status]}
                </Text>
                {link.status === "pending" && (
                  <Button label="Zurückziehen" size="sm" variant="secondary" onPress={() => confirmWithdraw(link)} />
                )}
              </View>
            }
          />
        ))
      )}

      <Text style={[styles.sectionTitle, styles.spaced]}>Reposts</Text>
      {reposts.length === 0 ? (
        <Text style={styles.muted}>Noch keine Reposts.</Text>
      ) : (
        reposts.map((repost) => (
          <ProfileRow
            key={repost.id}
            profile={repost.reposter}
            onPress={() => openProfile(repost.reposter.id)}
            accessory={<Text style={styles.status}>{formatRelativeTime(repost.createdAt)}</Text>}
          />
        ))
      )}
      <Text style={styles.muted}>
        Reposts kann nur die Person löschen, die repostet hat. Sie sind nur für Leute sichtbar, die auch deinen Post sehen
        dürfen.
      </Text>
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
      gap: spacing.xs,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
      paddingHorizontal: spacing.md,
    },
    spaced: {
      marginTop: spacing.lg,
    },
    accessory: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    status: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "600",
    },
    accepted: {
      color: colors.success,
    },
    muted: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
      lineHeight: 19,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);
