import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/**
 * The intro after sign-up. The server remembers it (profiles.onboarding_done_at) so it doesn't
 * come back on a new device; this device also remembers it, so it is never forced twice (an
 * interrupted intro counts as seen) and can always be closed offline. A failed save is retried
 * on the next start.
 */

/** "seen": shown here, not confirmed by the server yet. "done": the server has it. */
type LocalState = "seen" | "done";

const storageKey = (userId: string) => `peakpic.onboarding.${userId}`;
// Don't keep the splash screen up longer than this while asking the server.
const CHECK_TIMEOUT_MS = 4000;

async function readLocal(userId: string): Promise<LocalState | null> {
  const value = await AsyncStorage.getItem(storageKey(userId)).catch(() => null);
  return value === "seen" || value === "done" ? value : null;
}

function writeLocal(userId: string, state: LocalState): Promise<void> {
  return AsyncStorage.setItem(storageKey(userId), state).catch(() => undefined);
}

/** Tells the server the intro is done (the database stamps the time). Throws on failure. */
async function saveDone(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_done_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
  await writeLocal(userId, "done");
}

async function serverSaysDone(userId: string): Promise<boolean> {
  const query = supabase.from("profiles").select("onboarding_done_at").eq("id", userId).single();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS));
  const { data, error } = await Promise.race([query, timeout]);
  if (error) throw error;
  return data.onboarding_done_at !== null;
}

type OnboardingState = {
  /** null while checking (keep the splash screen up). */
  needed: boolean | null;
  /** The intro is on screen: from now on it is never forced again on this device. */
  markSeen: () => void;
  /** Finished or skipped: the app opens; the server is told (retried later if offline). */
  complete: () => void;
};

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const userId = useSession().session?.user.id ?? null;
  // Result per user, so switching accounts checks again.
  const [result, setResult] = useState<{ userId: string; needed: boolean } | null>(null);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    const decide = (needed: boolean) => {
      if (active) setResult({ userId, needed });
    };
    void (async () => {
      const local = await readLocal(userId);
      if (local === "done") return decide(false);
      if (local === "seen") {
        // Interrupted or saved offline last time: don't force it again, just retry the save.
        decide(false);
        await saveDone(userId).catch(() => undefined);
        return;
      }
      try {
        const done = await serverSaysDone(userId);
        if (done) await writeLocal(userId, "done");
        decide(!done);
      } catch {
        // Offline or slow: open the app; the check runs again on the next start.
        decide(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const needed = userId === null ? false : result?.userId === userId ? result.needed : null;

  const markSeen = useCallback(() => {
    if (userId === null) return;
    // Never downgrade a confirmed "done".
    void readLocal(userId).then((local) => (local === null ? writeLocal(userId, "seen") : undefined));
  }, [userId]);

  const complete = useCallback(() => {
    if (userId === null) return;
    setResult({ userId, needed: false });
    void writeLocal(userId, "seen").then(() => saveDone(userId).catch(() => undefined));
  }, [userId]);

  const value: OnboardingState = { needed, markSeen, complete };

  return <OnboardingContext value={value}>{children}</OnboardingContext>;
}

export function useOnboarding(): OnboardingState {
  const value = use(OnboardingContext);
  if (value === null) throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  return value;
}
