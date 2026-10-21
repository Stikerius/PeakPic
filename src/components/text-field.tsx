import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { fontSize, radius, spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type TextFieldProps = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  label: string;
  hint?: string;
};

export function TextField({ label, hint, ...inputProps }: TextFieldProps) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        keyboardAppearance={scheme}
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      gap: spacing.xs,
    },
    label: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "600",
    },
    input: {
      minHeight: 48,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.md,
    },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
  }),
);
