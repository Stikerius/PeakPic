import type { AuthError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export { USERNAME_PATTERN } from "@/lib/names";
export const MIN_PASSWORD_LENGTH = 6;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "E-Mail oder Passwort ist falsch.";
    case "email_not_confirmed":
      return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in deinem Postfach.";
    case "user_already_exists":
    case "email_exists":
      return "Für diese E-Mail-Adresse gibt es schon ein Konto. Melde dich an.";
    case "weak_password":
      return `Das Passwort ist zu schwach. Nimm mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
    case "email_address_invalid":
      return "Diese E-Mail-Adresse ist ungültig.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Zu viele Versuche. Warte kurz und probiere es dann nochmal.";
    case "signup_disabled":
      return "Registrierungen sind im Moment deaktiviert.";
    default:
      return "Etwas ist schiefgelaufen. Prüfe deine Verbindung und versuche es erneut.";
  }
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? authErrorMessage(error) : null;
}

export type SignUpResult =
  | { status: "signed-in" }
  | { status: "confirm-email" }
  | { status: "error"; message: string };

export async function signUp(
  email: string,
  password: string,
  rawUsername: string,
  rawDisplayName: string,
): Promise<SignUpResult> {
  const username = normalizeUsername(rawUsername);
  // Empty means "use the username" (the database fills it in).
  const displayName = rawDisplayName.trim();

  const { data: available, error: rpcError } = await supabase.rpc("username_available", {
    name: username,
  });
  if (rpcError) {
    return { status: "error", message: "Username konnte nicht geprüft werden. Versuche es erneut." };
  }
  if (!available) {
    return { status: "error", message: "Dieser Username ist schon vergeben." };
  }

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { username, display_name: displayName } },
  });
  if (error) return { status: "error", message: authErrorMessage(error) };
  // Without a session, the project requires email confirmation first.
  return data.session ? { status: "signed-in" } : { status: "confirm-email" };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
