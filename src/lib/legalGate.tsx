import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { useAccountStatus } from "@/lib/accountStatus";
import { confirmLegalDocuments, fetchMyLegalStatus, type LegalStatus } from "@/lib/legalRepo";
import { useSession } from "@/lib/session";

type LegalGateState = {
  /** null while checking. */
  status: LegalStatus[] | null;
  /** Current versions that still need my confirmation. */
  pending: LegalStatus[];
  /** True while something must be confirmed before the app opens (not postponed). */
  needed: boolean;
  /** "Später": hidden until the next app start. */
  postpone: (documentIds: string[]) => void;
  /** Right after a successful confirmation: updates the state at once, then reloads. */
  markConfirmed: (documentIds: string[]) => void;
  refresh: () => void;
};

const LegalGateContext = createContext<LegalGateState | null>(null);
const CHECK_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)),
  ]);
}

// The versions accepted in the sign-up form. The session (and with it the first check below)
// starts inside supabase.auth.signUp, before the form could confirm them; so the gate confirms
// them itself before its first check. Otherwise the new account is asked for them again.
let signUpConfirmation: string[] | null = null;

/** Set right before signUp; null when sign-up failed or waits for the e-mail confirmation. */
export function confirmOnSignUp(documentIds: string[] | null): void {
  signUpConfirmation = documentIds;
}

async function checkStatus(): Promise<LegalStatus[]> {
  const ids = signUpConfirmation;
  signUpConfirmation = null;
  // If this fails (network), the gate simply asks for the texts again.
  if (ids !== null) await confirmLegalDocuments(ids).catch(() => undefined);
  return fetchMyLegalStatus();
}

/**
 * After login: which current legal texts are still unconfirmed. If the check fails (offline),
 * the app opens and the check runs again on the next start. Postponing lasts for this session.
 */
export function LegalGateProvider({ children }: { children: ReactNode }) {
  const userId = useSession().session?.user.id ?? null;
  const { account } = useAccountStatus();
  const [result, setResult] = useState<{ userId: string; status: LegalStatus[] } | null>(null);
  const [postponed, setPostponed] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(() => {
    if (userId === null) return () => undefined;
    let active = true;
    withTimeout(checkStatus())
      .then((status) => {
        if (active) setResult({ userId, status });
      })
      .catch(() => {
        if (active) setResult({ userId, status: [] });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  // Again when the account status changes (e.g. after confirming lifted a suspension).
  useEffect(load, [load, account?.status]);

  const status = userId === null ? [] : result?.userId === userId ? result.status : null;
  const pending = (status ?? []).filter((doc) => doc.requiresConfirmation && doc.confirmedAt === null);
  const needed = pending.some((doc) => !postponed.has(doc.documentId));

  const value: LegalGateState = {
    status,
    pending,
    needed,
    postpone: (ids) => setPostponed((current) => new Set([...current, ...ids])),
    markConfirmed: (ids) => {
      // Without this the gate would keep the old status until the reload is back, and the
      // router guards would still block the app.
      const now = new Date().toISOString();
      setResult((current) =>
        current === null
          ? current
          : {
              ...current,
              status: current.status.map((doc) =>
                ids.includes(doc.documentId)
                  ? { ...doc, confirmedAt: now, lastConfirmedVersion: doc.version, lastConfirmedAt: now }
                  : doc,
              ),
            },
      );
      load();
    },
    refresh: () => void load(),
  };
  return <LegalGateContext value={value}>{children}</LegalGateContext>;
}

export function useLegalGate(): LegalGateState {
  const value = use(LegalGateContext);
  if (value === null) throw new Error("useLegalGate must be used inside <LegalGateProvider>");
  return value;
}
