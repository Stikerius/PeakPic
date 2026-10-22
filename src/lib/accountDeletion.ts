import AsyncStorage from "@react-native-async-storage/async-storage";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Directory, Paths } from "expo-file-system";
import { Image } from "expo-image";

import { SUPPORT_EMAIL } from "@/constants/app";
import { authErrorMessage } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export type DeletionResult =
  | { status: "deleted" }
  /** The sign-in is older than 5 minutes: enter the password again. */
  | { status: "reauth" }
  | { status: "error"; message: string };

export const DELETION_NOT_ALLOWED = `Löschung gerade nicht möglich, bitte wende dich an den Support (${SUPPORT_EMAIL}).`;
// Only after step 1 ran on the server (status 'deleting').
const INCOMPLETE =
  "Die Löschung wurde nicht abgeschlossen. Dein Konto ist bereits unsichtbar. Versuche es erneut; bereits Gelöschtes bleibt gelöscht.";
const NOT_STARTED = "Die Löschung konnte nicht gestartet werden. Es wurde nichts gelöscht. Versuche es später erneut.";
const NETWORK =
  "Keine Verbindung zum Server. Es wurde nichts oder nur ein Teil gelöscht. Versuche es erneut, sobald du online bist.";
// The function deletes at most 20 000 files per call and then asks to be called again.
const MAX_ROUNDS = 10;

/** Signs in again with my own e-mail, right before deleting (fresh sign-in for the server). */
export async function reauthenticate(password: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (email === undefined) return "Du bist nicht mehr angemeldet. Melde dich erneut an.";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error === null) return null;
  return error.code === "invalid_credentials" ? "Das Passwort ist falsch." : authErrorMessage(error);
}

/** Error code from the function's JSON answer, or `http_<status>` (e.g. 404: not deployed). */
async function errorCode(error: FunctionsHttpError): Promise<string> {
  const context: unknown = error.context;
  if (!(context instanceof Response)) return "unknown";
  try {
    const body: unknown = await context.clone().json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // no JSON body
  }
  return `http_${context.status}`;
}

/**
 * Deletes my own account on the server (Edge Function delete_account). The server takes the
 * account from my session, never from the request. Safe to call again after a failure.
 */
export async function deleteMyAccount(): Promise<DeletionResult> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { data, error } = await supabase.functions.invoke("delete_account", { body: {} });
    if (error) {
      if (!(error instanceof FunctionsHttpError)) return { status: "error", message: NETWORK };
      const code = await errorCode(error);
      if (code === "reauth_required") return { status: "reauth" };
      if (code === "deletion_not_allowed") return { status: "error", message: DELETION_NOT_ALLOWED };
      if (code === "incomplete") return { status: "error", message: INCOMPLETE };
      return { status: "error", message: `${NOT_STARTED} (Fehler: ${code})` };
    }
    const status: unknown = typeof data === "object" && data !== null && "status" in data ? data.status : null;
    if (status === "deleted") return { status: "deleted" };
    if (status !== "partial") return { status: "error", message: INCOMPLETE };
  }
  return { status: "error", message: INCOMPLETE };
}

function deleteDirectoryContents(directory: Directory): void {
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    try {
      entry.delete();
    } catch {
      // in use by the system; the OS clears caches on its own
    }
  }
}

/**
 * After a successful deletion: nothing of the account stays on the device. Closes realtime
 * channels, removes stored data, photos, caches and the session (which leads to the login).
 */
export async function clearLocalData(): Promise<void> {
  await supabase.removeAllChannels().catch(() => undefined);
  try {
    const photos = new Directory(Paths.document, "photos");
    if (photos.exists) photos.delete();
    deleteDirectoryContents(new Directory(Paths.cache));
  } catch {
    // best effort
  }
  await Promise.all([Image.clearDiskCache().catch(() => false), Image.clearMemoryCache().catch(() => false)]);
  await AsyncStorage.clear().catch(() => undefined);
  // The server session is gone with the account; only the local one is left to end.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
