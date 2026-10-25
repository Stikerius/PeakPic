import Ionicons from "@expo/vector-icons/Ionicons";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { fontSize, spacing } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type CameraPermissionPromptProps = {
  /** False once the user has denied the system dialog; iOS won't show it again. */
  canAskAgain: boolean;
  onRequest: () => void;
  onPickFromGallery: () => void;
};

export function CameraPermissionPrompt({
  canAskAgain,
  onRequest,
  onPickFromGallery,
}: CameraPermissionPromptProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Ionicons
        name="camera-outline"
        size={64}
        color={colors.accent}
        style={styles.icon}
      />
      <Text style={styles.title}>Kamerazugriff benötigt</Text>
      <Text style={styles.body}>
        {canAskAgain
          ? "PeakPic braucht die Kamera, damit du nach dem Training ein Workout-Foto aufnehmen kannst. Jedes Foto zählt für deinen Streak."
          : Platform.OS === "web"
            ? "Du hast den Kamerazugriff abgelehnt. Du kannst ihn in den Website-Einstellungen deines Browsers wieder erlauben (Symbol links in der Adressleiste) – oder stattdessen ein Foto vom Computer wählen."
            : "Du hast den Kamerazugriff abgelehnt. Du kannst ihn jederzeit in den Einstellungen deines iPhones wieder erlauben – oder stattdessen ein Foto aus deiner Galerie wählen."}
      </Text>
      {canAskAgain ? (
        <Button label="Kamera erlauben" onPress={onRequest} />
      ) : Platform.OS === "web" ? null : (
        <Button
          label="Einstellungen öffnen"
          onPress={() => void Linking.openSettings()}
        />
      )}
      <Button
        label="Aus Galerie wählen"
        variant="secondary"
        onPress={onPickFromGallery}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "stretch",
      gap: spacing.md,
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    icon: {
      alignSelf: "center",
    },
    title: {
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: "700",
      textAlign: "center",
    },
    body: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      lineHeight: 22,
      textAlign: "center",
      marginBottom: spacing.md,
    },
  }),
);
