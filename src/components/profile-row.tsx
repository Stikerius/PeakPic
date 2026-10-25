import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { OfficialBadge } from "@/components/surveys/official-badge";
import { Avatar } from "@/components/ui/avatar";
import { spacing, typography } from "@/constants/theme";
import { useOfficialAccountId } from "@/lib/officialAccount";
import { makeStyles } from "@/lib/theme";
import type { PublicProfile } from "@/types/social";

type ProfileRowProps = {
  profile: PublicProfile;
  /** Rendered on the right, e.g. a follow or send button. */
  accessory?: ReactNode;
  /** Makes avatar and name tappable (e.g. to open the profile). */
  onPress?: () => void;
};

export function ProfileRow({ profile, accessory, onPress }: ProfileRowProps) {
  const styles = useStyles();
  // The official account carries its badge everywhere it is listed (e.g. the search).
  const official = useOfficialAccountId() === profile.id;
  const identity = (
    <>
      <Avatar uri={profile.avatarUrl} username={profile.username} size={44} />
      <View style={styles.names}>
        <Text style={styles.displayName} numberOfLines={1}>
          {profile.displayName}
        </Text>
        <Text style={styles.handle} numberOfLines={1}>
          @{profile.username}
        </Text>
        {official && <OfficialBadge />}
      </View>
    </>
  );
  return (
    <View style={styles.row}>
      {onPress !== undefined ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Profil von ${profile.username}`}
          style={styles.identity}
        >
          {identity}
        </Pressable>
      ) : (
        <View style={styles.identity}>{identity}</View>
      )}
      {accessory}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    identity: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    names: {
      flex: 1,
    },
    displayName: {
      ...typography.body,
      fontWeight: "600",
      color: colors.text,
    },
    handle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
