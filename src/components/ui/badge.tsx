import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, typography } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";

type BadgeProps = {
  /** A count (shown as "99+" above 99) or a short label. */
  value: number | string;
  /** accent for unread/new counts, neutral for plain information. */
  tone?: "accent" | "neutral";
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Badge({ value, tone = "accent", accessibilityLabel, style }: BadgeProps) {
  const styles = useStyles();
  const text = typeof value === "number" && value > 99 ? "99+" : String(value);
  return (
    <View style={[styles.badge, styles[tone], style]} accessibilityLabel={accessibilityLabel}>
      <Text style={[styles.text, tone === "accent" ? styles.textAccent : styles.textNeutral]} allowFontScaling={false}>
        {text}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    accent: {
      backgroundColor: colors.accent,
    },
    neutral: {
      backgroundColor: colors.surfaceRaised,
    },
    text: {
      ...typography.label,
      ...typography.numeric,
      fontWeight: "600",
    },
    textAccent: {
      color: colors.onAccent,
    },
    textNeutral: {
      color: colors.textSecondary,
    },
  }),
);
