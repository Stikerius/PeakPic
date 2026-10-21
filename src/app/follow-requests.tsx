import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import { ProfileRow } from "@/components/profile-row";
import { Button } from "@/components/ui/button";
import { fontSize, spacing } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { acceptFollowRequest, declineFollowRequest, listFollowRequests, type FollowRequest } from "@/lib/socialRepo";
import { makeStyles, useTheme } from "@/lib/theme";

/** Open requests to follow my private profile: confirm or decline. */
export default function FollowRequestsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const openProfile = useOpenProfile();
  const [requests, setRequests] = useState<FollowRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listFollowRequests()
      .then(setRequests)
      .catch((loadError: unknown) => setError(describeError(loadError)));
  }, []);

  async function answer(request: FollowRequest, accept: boolean) {
    setBusyId(request.profile.id);
    setError(null);
    try {
      if (accept) await acceptFollowRequest(request.profile.id);
      else await declineFollowRequest(request.profile.id);
      setRequests((prev) => prev?.filter((r) => r.profile.id !== request.profile.id) ?? prev);
      emitAppEvent("followChanged", undefined);
    } catch (answerError) {
      setError(describeError(answerError));
    } finally {
      setBusyId(null);
    }
  }

  if (requests === null) {
    return (
      <View style={styles.centered}>
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={requests}
      keyExtractor={(r) => r.profile.id}
      ListHeaderComponent={error !== null ? <Text style={[styles.error, styles.padded]}>{error}</Text> : null}
      renderItem={({ item }) => (
        <ProfileRow
          profile={item.profile}
          onPress={() => openProfile(item.profile.id)}
          accessory={
            <View style={styles.actions}>
              <Button
                label="Bestätigen"
                size="sm"
                loading={busyId === item.profile.id}
                disabled={busyId !== null}
                onPress={() => void answer(item, true)}
              />
              <Button
                label="Ablehnen"
                size="sm"
                variant="secondary"
                disabled={busyId !== null}
                onPress={() => void answer(item, false)}
              />
            </View>
          }
        />
      )}
      ListEmptyComponent={<Text style={[styles.muted, styles.padded]}>Keine offenen Anfragen.</Text>}
    />
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
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.xs,
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
      fontSize: fontSize.sm,
      textAlign: "center",
    },
  }),
);
