import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { fontSize, spacing } from "@/constants/theme";
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
  const identity = (
    <>
      <Avatar uri={profile.avatarUrl} username={profile.username} size={44} />
      <Text style={styles.username} numberOfLines={1}>
        @{profile.username}
      </Text>
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
    username: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
  }),
);
