import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { colors, fontSize, radius, spacing } from "@/constants/theme";

type TextFieldProps = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  label: string;
  hint?: string;
};

export function TextField({ label, hint, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
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
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
});
