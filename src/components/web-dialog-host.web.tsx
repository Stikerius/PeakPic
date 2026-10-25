import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { makeStyles } from "@/lib/theme";
import { closeDialog, dismissButton, orderedButtons, showDialog, subscribeDialogs, toDialog, type Dialog, type DialogButton } from "@/lib/webDialogs";

// react-native-web's Alert.alert does nothing; from here on it opens the dialog below.
(Alert as unknown as { alert: (title: unknown, message?: unknown, buttons?: unknown) => void }).alert = (title, message, buttons) =>
  showDialog(toDialog(title, message, buttons));

/**
 * Web: shows Alert.alert and the action menus as a dialog (role "alertdialog", focus kept inside
 * by the modal, Escape and a click outside choose "Abbrechen"). One at a time, in order.
 */
export function WebDialogHost() {
  const styles = useStyles();
  const [dialogs, setDialogs] = useState<readonly Dialog[]>([]);
  useEffect(() => subscribeDialogs(setDialogs), []);
  const dialog = dialogs[0];
  if (dialog === undefined) return null;

  const choose = (button: DialogButton | null) => {
    if (button === null) return;
    closeDialog(dialog.id);
    button.onPress?.();
  };
  const buttons = orderedButtons(dialog);
  const stacked = buttons.length > 2;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => choose(dismissButton(dialog))}>
      <Pressable style={styles.backdrop} onPress={() => choose(dismissButton(dialog))} accessibilityLabel="Schliessen" accessibilityRole="button">
        <Pressable
          style={styles.card}
          onPress={() => undefined}
          accessibilityRole={"alertdialog" as never}
          accessibilityLabel={dialog.title || dialog.message || "Hinweis"}
          accessibilityViewIsModal
        >
          {dialog.title !== "" && (
            <Text style={styles.title} accessibilityRole="header">
              {dialog.title}
            </Text>
          )}
          {dialog.message !== null && <Text style={styles.message}>{dialog.message}</Text>}
          <View style={stacked ? styles.stack : styles.row}>
            {buttons.map((button, i) => (
              <Button
                key={`${dialog.id}-${i}`}
                label={button.text}
                variant={button.style === "cancel" ? "secondary" : stacked ? "secondary" : "primary"}
                destructive={button.style === "destructive"}
                style={stacked ? undefined : styles.flex}
                onPress={() => choose(button)}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.md,
      backgroundColor: colors.backdrop,
    },
    card: {
      width: "100%",
      maxWidth: 400,
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceRaised,
    },
    title: {
      ...typography.heading,
      color: colors.text,
    },
    message: {
      ...typography.body,
      color: colors.textSecondary,
    },
    row: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    stack: {
      gap: spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
