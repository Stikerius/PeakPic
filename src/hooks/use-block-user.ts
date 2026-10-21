import { Alert } from "react-native";

import { blockUser } from "@/lib/blockRepo";
import { describeError } from "@/lib/errors";

/** "Blockieren" with a short explanation and a confirmation. */
export function useBlockUser(): (user: { id: string; displayName: string }, onBlocked?: () => void) => void {
  return (user, onBlocked) => {
    Alert.alert(
      `${user.displayName} blockieren?`,
      "Ihr seht gegenseitig keine Profile, Beiträge, Storys und Kommentare mehr und könnt euch nicht folgen, markieren oder neu anschreiben. Bestehende Follows werden entfernt. Die Person wird nicht benachrichtigt. Du kannst das in den Einstellungen rückgängig machen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Blockieren",
          style: "destructive",
          onPress: () => {
            blockUser(user.id)
              .then(() => onBlocked?.())
              .catch((error: unknown) => Alert.alert("Blockieren fehlgeschlagen", describeError(error)));
          },
        },
      ],
    );
  };
}
