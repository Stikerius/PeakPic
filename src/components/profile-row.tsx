import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { colors, fontSize, spacing } from "@/constants/theme";
import type { PublicProfile } from "@/types/social";

type ProfileRowProps = {
  profile: PublicProfile;
  /** Rendered on the right, e.g. a follow or send button. */
  accessory?: ReactNode;
};

export function ProfileRow({ profile, accessory }: ProfileRowProps) {
  return (
    <View style={styles.row}>
      <Avatar uri={profile.avatarUrl} username={profile.username} size={44} />
      <Text style={styles.username} numberOfLines={1}>
        @{profile.username}
      </Text>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  username: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
});
