import { StyleSheet, Text, View } from "react-native";

import { fontSize, spacing } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";

type ScreenPlaceholderProps = {
  title: string;
};

export function ScreenPlaceholder({ title }: ScreenPlaceholderProps) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
      backgroundColor: colors.background,
    },
    title: {
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: "700",
    },
  }),
);
