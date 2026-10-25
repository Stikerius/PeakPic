import { useState } from "react";
import { Alert } from "react-native";

import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { useOfficialAccountId } from "@/lib/officialAccount";
import { followUser, unfollowUser, type FollowStatus } from "@/lib/socialRepo";

type FollowButtonProps = {
  userId: string;
  username: string;
  status: FollowStatus;
  onChange: (status: FollowStatus) => void;
  size?: "sm" | "md";
};

const LABELS: Record<FollowStatus, string> = {
  none: "Folgen",
  pending: "Angefragt",
  accepted: "Folge ich",
};

/**
 * Folgen / Angefragt / Folge ich. Whether a follow is accepted right away or becomes a
 * request is decided by the database (public vs. private profile). Not shown at all for the
 * official account (it takes no followers).
 */
export function FollowButton({ userId, username, status, onChange, size = "sm" }: FollowButtonProps) {
  const [busy, setBusy] = useState(false);
  const officialId = useOfficialAccountId();

  async function run(action: () => Promise<FollowStatus>) {
    setBusy(true);
    try {
      onChange(await action());
      emitAppEvent("followChanged", undefined);
    } catch (error) {
      Alert.alert("Das hat nicht geklappt", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  function press() {
    if (status === "none") {
      void run(() => followUser(userId));
      return;
    }
    const withdraw = status === "pending";
    Alert.alert(
      withdraw ? "Anfrage zurückziehen?" : `@${username} nicht mehr folgen?`,
      withdraw ? undefined : "Bei einem privaten Profil musst du danach erneut anfragen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: withdraw ? "Zurückziehen" : "Nicht mehr folgen",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              await unfollowUser(userId);
              return "none";
            }),
        },
      ],
    );
  }

  // Hidden for the official account, and until it is known (no button that disappears again).
  if (officialId === undefined || userId === officialId) return null;
  return (
    <Button
      label={LABELS[status]}
      variant={status === "none" ? "primary" : "secondary"}
      size={size}
      loading={busy}
      onPress={press}
    />
  );
}
