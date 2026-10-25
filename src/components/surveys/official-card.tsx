import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { remainingText, type OfficialItem } from "../../../shared/surveys";
import { OfficialBadge } from "@/components/surveys/official-badge";
import { SurveyMediaRow } from "@/components/surveys/survey-media";
import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { showActionSheet } from "@/lib/actionSheet";
import { makeStyles, useTheme } from "@/lib/theme";

type OfficialCardProps = {
  item: OfficialItem;
  /** "Teilnehmen" / "Ergebnis ansehen". */
  onOpen: () => void;
  /** The badge opens the official profile (not on the profile itself). */
  onOpenProfile?: () => void;
  /** "Später": the card moves to its normal place (feed only). */
  onLater?: () => void;
  /** "Ausblenden" in the menu (feed only). */
  onDismiss?: () => void;
  now?: Date;
};

/** What VoiceOver reads for the whole card. */
export function officialCardLabel(item: OfficialItem, now: Date): string {
  if (item.kind === "results") {
    return `Offizielle Auswertung: ${item.title}. ${item.snapshot?.participants ?? 0} Teilnahmen.`;
  }
  const status = item.answered ? "Teilgenommen" : item.state === "active" ? remainingText(item.endsAt, now) : "Beendet";
  return `Offizielle Umfrage: ${item.title}. ${status}.`;
}

/**
 * A survey or a results post of the official account: badge, title, topic or conclusion, images
 * or logos, time left, one clear action. No likes, comments or sharing.
 */
export function OfficialCard({ item, onOpen, onOpenProfile, onLater, onDismiss, now = new Date() }: OfficialCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isSurvey = item.kind === "survey";
  const open = isSurvey && item.state === "active" && !item.answered;
  const meta = isSurvey ? (item.answered ? "Teilgenommen" : item.state === "active" ? remainingText(item.endsAt, now) : "Beendet") : "Auswertung";

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.header}>
        <OfficialBadge onPress={onOpenProfile} />
        <Text style={styles.kind}>{isSurvey ? "Umfrage" : "Ergebnis"}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
        {onDismiss !== undefined && (
          <Pressable
            onPress={() => showActionSheet(item.title, [{ label: "Ausblenden", destructive: true, onPress: onDismiss }])}
            accessibilityRole="button"
            accessibilityLabel="Weitere Optionen"
            hitSlop={spacing.sm}
            style={styles.more}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={officialCardLabel(item, now)} style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <Text style={styles.title}>{item.title}</Text>
        {isSurvey && item.topic !== null && (
          <Text style={styles.text} numberOfLines={4}>
            {item.topic}
          </Text>
        )}
        {!isSurvey && item.snapshot !== null && (
          <>
            <Text style={styles.text} numberOfLines={4}>
              {item.snapshot.conclusion}
            </Text>
            <Text style={styles.meta}>{item.snapshot.participants} Teilnahmen</Text>
          </>
        )}
      </Pressable>

      <SurveyMediaRow media={item.media} compact />

      <View style={styles.actions}>
        {isSurvey && open && <Button label="Teilnehmen" onPress={onOpen} size="sm" />}
        {isSurvey && open && onLater !== undefined && <Button label="Später" variant="ghost" onPress={onLater} size="sm" />}
        {isSurvey && item.answered && (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={18} color={colors.textSecondary} />
            <Text style={styles.doneText}>Teilgenommen</Text>
          </View>
        )}
        {isSurvey && !open && !item.answered && <Text style={styles.doneText}>Diese Umfrage ist beendet.</Text>}
        {!isSurvey && <Button label="Ergebnis ansehen" variant="secondary" onPress={onOpen} size="sm" />}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      marginHorizontal: spacing.md,
      marginVertical: spacing.sm,
      padding: spacing.md,
      gap: spacing.ms,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    kind: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    more: {
      marginLeft: "auto",
      minWidth: 44,
      minHeight: 44,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    body: {
      gap: spacing.xs,
    },
    pressed: {
      opacity: 0.7,
    },
    title: {
      ...typography.heading,
      color: colors.text,
    },
    text: {
      ...typography.body,
      color: colors.text,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    done: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    doneText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
