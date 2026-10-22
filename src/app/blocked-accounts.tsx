import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { ListSkeleton } from "@/components/ui/skeleton";
import { spacing } from "@/constants/theme";
import { listBlockedAccounts, unblockUser, type BlockedAccount } from "@/lib/blockRepo";
import { describeError } from "@/lib/errors";
import { makeStyles } from "@/lib/theme";
import { useTrackScreen } from "@/lib/usage";

export default function BlockedAccountsScreen() {
  useTrackScreen("screen_blocked");
  const styles = useStyles();
  const [accounts, setAccounts] = useState<BlockedAccount[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    listBlockedAccounts()
      .then((result) => {
        if (!active) return;
        setAccounts(result);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  function confirmUnblock(account: BlockedAccount) {
    Alert.alert(
      `${account.displayName} entblocken?`,
      "Ihr seht euch wieder gegenseitig. Frühere Follows werden nicht wiederhergestellt.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Entblocken",
          onPress: () => {
            setBusyId(account.id);
            unblockUser(account.id)
              .then(() => setAccounts((current) => current?.filter((a) => a.id !== account.id) ?? null))
              .catch((error: unknown) => Alert.alert("Entblocken fehlgeschlagen", describeError(error)))
              .finally(() => setBusyId(null));
          },
        },
      ],
    );
  }

  if (accounts === null) {
    return (
      <View style={styles.screen}>
        {failed ? (
          <ErrorState
            fill
            onRetry={() => {
              setFailed(false);
              load();
            }}
          />
        ) : (
          <ListSkeleton rows={4} />
        )}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={accounts}
      keyExtractor={(account) => account.id}
      ItemSeparatorComponent={() => <Divider inset={spacing.md + 40 + spacing.ms} />}
      ListEmptyComponent={
        <EmptyState
          icon="hand-left-outline"
          title="Keine blockierten Konten"
          message="Blockieren kannst du über das Menü im Profil oder im Chat einer Person."
        />
      }
      renderItem={({ item }) => (
        <ListItem
          leading={<Avatar uri={item.avatarUrl} username={item.username} size={40} />}
          title={item.displayName}
          subtitle={`@${item.username}`}
          trailing={
            <Button
              label="Entblocken"
              variant="secondary"
              size="sm"
              loading={busyId === item.id}
              onPress={() => confirmUnblock(item)}
            />
          }
        />
      )}
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
  }),
);
