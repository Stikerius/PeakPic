import Ionicons from "@expo/vector-icons/Ionicons";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { ProfileRow } from "@/components/profile-row";
import { colors, fontSize, spacing } from "@/constants/theme";
import { formatRelativeTime } from "@/lib/format";
import type { StoryActivity } from "@/lib/storyRepo";

type StoryActivitySheetProps = {
  activity: StoryActivity | null;
  visible: boolean;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
};

/** Viewers and likes of one of my stories. */
export function StoryActivitySheet({ activity, visible, onClose, onOpenProfile }: StoryActivitySheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.counts}>
            <Ionicons name="eye-outline" size={20} color={colors.text} />
            <Text style={styles.count}>{activity?.viewCount ?? 0}</Text>
            <Ionicons name="heart" size={20} color={colors.danger} style={styles.heartIcon} />
            <Text style={styles.count}>{activity?.likeCount ?? 0}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schliessen" hitSlop={spacing.sm}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
        <FlatList
          data={activity?.viewers ?? []}
          keyExtractor={(viewer) => viewer.profile.id}
          renderItem={({ item }) => (
            <ProfileRow
              profile={item.profile}
              onPress={() => onOpenProfile(item.profile.id)}
              accessory={
                <View style={styles.accessory}>
                  <Text style={styles.time}>{formatRelativeTime(item.at)}</Text>
                  {item.liked && (
                    <Ionicons name="heart" size={20} color={colors.danger} accessibilityLabel="Gefällt" />
                  )}
                </View>
              }
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>Noch niemand hat deine Story gesehen.</Text>}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  counts: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  count: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  heartIcon: {
    marginLeft: spacing.md,
  },
  accessory: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  time: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
    padding: spacing.xl,
  },
});
