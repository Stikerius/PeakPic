import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type TextFieldProps = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  label: string;
  hint?: string;
  /** Shown instead of the hint, with a red outline. */
  error?: string | null;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, onFocus, onBlur, ...inputProps },
  ref,
) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const hasError = error !== undefined && error !== null && error !== "";

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        keyboardAppearance={scheme}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        accessibilityLabel={label}
        accessibilityHint={hasError ? error : hint}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        style={[styles.input, focused && styles.focused, hasError && styles.invalid]}
      />
      {hasError ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        hint !== undefined && <Text style={styles.hint}>{hint}</Text>
      )}
    </View>
  );
});

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      gap: spacing.xs + 2,
    },
    label: {
      ...typography.label,
      color: colors.textSecondary,
    },
    input: {
      ...typography.body,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
    },
    focused: {
      borderColor: colors.textTertiary,
    },
    invalid: {
      borderColor: colors.danger,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
  }),
);
