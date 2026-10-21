import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchWhoami, type StaffRole } from "./api";
import { supabase } from "./supabase";

/**
 * Sign-in flow: password -> second factor (TOTP; enrolled with a QR code the first time,
 * checked on every login) -> staff role. Only "ready" shows any data. The session lives in
 * memory only; after 30 minutes without input the dashboard signs out and reloads, so nothing
 * stays in memory.
 */
export type AuthState =
  | { step: "loading" }
  | { step: "signed-out" }
  | { step: "enroll"; factorId: string; qrCode: string; secret: string }
  | { step: "verify"; factorId: string }
  | { step: "no-role" }
  | { step: "ready"; role: StaffRole; email: string };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<string | null>;
  verifyCode: (code: string) => Promise<string | null>;
  signOut: () => void;
};

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const AuthContext = createContext<AuthContextValue | null>(null);

/** Signs out and reloads: clears the in-memory session and every loaded record. */
function hardSignOut(): void {
  void supabase.auth.signOut().finally(() => {
    window.location.hash = "";
    window.location.reload();
  });
}

async function nextStep(): Promise<AuthState> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (session === null) return { step: "signed-out" };

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) throw aalError;
  if (aal.currentLevel !== "aal2") {
    const { data: factors, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    const verified = factors.totp.find((factor) => factor.status === "verified");
    if (verified !== undefined) return { step: "verify", factorId: verified.id };
    // Leftovers of an interrupted enrollment are removed before starting again.
    for (const factor of factors.all) {
      if (factor.factor_type === "totp" && factor.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `PeakPic Admin ${new Date().toISOString().slice(0, 10)}`,
    });
    if (enrollError) throw enrollError;
    return { step: "enroll", factorId: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret };
  }

  const who = await fetchWhoami();
  if (who.role === null || !who.hasAal2) return { step: "no-role" };
  return { step: "ready", role: who.role, email: session.user.email ?? "" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ step: "loading" });

  const refresh = useCallback(async () => {
    try {
      setState(await nextStep());
    } catch {
      setState({ step: "signed-out" });
    }
  }, []);

  useEffect(() => {
    let active = true;
    nextStep()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState({ step: "signed-out" });
      });
    return () => {
      active = false;
    };
  }, []);

  // Inactivity: any input resets the timer; when it runs out, sign out and reload.
  useEffect(() => {
    if (state.step === "signed-out" || state.step === "loading") return;
    let timer = window.setTimeout(hardSignOut, IDLE_LIMIT_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(hardSignOut, IDLE_LIMIT_MS);
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, reset);
    };
  }, [state.step]);

  async function signIn(email: string, password: string): Promise<string | null> {
    const trimmed = email.trim();
    if (!trimmed.includes("@") || password.length === 0) return "E-Mail und Passwort eingeben.";
    const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
    if (error) return "Anmeldung fehlgeschlagen.";
    await refresh();
    return null;
  }

  async function verifyCode(code: string): Promise<string | null> {
    if (state.step !== "enroll" && state.step !== "verify") return null;
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) return "Bitte den 6-stelligen Code eingeben.";
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: digits });
    if (error) return "Code ungültig oder abgelaufen.";
    await refresh();
    return null;
  }

  return <AuthContext value={{ state, signIn, verifyCode, signOut: hardSignOut }}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
