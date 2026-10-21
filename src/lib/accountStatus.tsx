import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { AccountStatus } from "@/types/database";

export type MyAccountStatus = {
  /** "active" also for a suspension that has already run out (the database decides). */
  status: AccountStatus;
  suspendedUntil: string | null;
  reasonCode: string | null;
  /** Text from the moderators the user may read. */
  message: string | null;
};

const ACTIVE: MyAccountStatus = { status: "active", suspendedUntil: null, reasonCode: null, message: null };
// Don't keep the splash screen up longer than this.
const CHECK_TIMEOUT_MS = 4000;

/** My moderation status (also callable while suspended or banned). */
export async function fetchMyAccountStatus(): Promise<MyAccountStatus> {
  const request = supabase.rpc("get_my_account_status", {});
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS));
  const { data, error } = await Promise.race([request, timeout]);
  if (error) throw error;
  const row = data[0];
  if (row === undefined) return ACTIVE;
  return { status: row.status, suspendedUntil: row.suspended_until, reasonCode: row.reason_code, message: row.message };
}

type AccountStatusState = {
  /** null while checking. */
  account: MyAccountStatus | null;
  refresh: () => void;
};

const AccountStatusContext = createContext<AccountStatusState | null>(null);

/**
 * Loads my account status after login. If it can't be loaded (offline), the app opens as
 * usual: the database refuses every write of an inactive account anyway.
 */
export function AccountStatusProvider({ children }: { children: ReactNode }) {
  const userId = useSession().session?.user.id ?? null;
  const [result, setResult] = useState<{ userId: string; account: MyAccountStatus } | null>(null);

  const load = useCallback(() => {
    if (userId === null) return () => undefined;
    let active = true;
    fetchMyAccountStatus()
      .then((account) => {
        if (active) setResult({ userId, account });
      })
      .catch(() => {
        if (active) setResult({ userId, account: ACTIVE });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(load, [load]);

  // A suspension may start or end while the app is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
    });
    return () => subscription.remove();
  }, [load]);

  const account = userId === null ? ACTIVE : result?.userId === userId ? result.account : null;
  return <AccountStatusContext value={{ account, refresh: () => void load() }}>{children}</AccountStatusContext>;
}

export function useAccountStatus(): AccountStatusState {
  const value = use(AccountStatusContext);
  if (value === null) throw new Error("useAccountStatus must be used inside <AccountStatusProvider>");
  return value;
}
