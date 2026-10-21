/** Same rule as profiles.username in the database. */
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;

/** Same limits as the database (profiles_display_name_check, profiles_guard trigger). */
export const DISPLAY_NAME_MAX_LENGTH = 30;
export const USERNAME_CHANGE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Error text for a display name, or null if it is fine. Expects the trimmed value. */
export function displayNameError(displayName: string): string | null {
  if (displayName.length === 0) return "Gib einen Anzeigenamen ein.";
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) return `Höchstens ${DISPLAY_NAME_MAX_LENGTH} Zeichen.`;
  return null;
}

/** Error text for a (normalized) username, or null if the format is fine. */
export function usernameFormatError(username: string): string | null {
  if (username.length < 3 || username.length > 20) return "3 bis 20 Zeichen.";
  if (!USERNAME_PATTERN.test(username)) return "Nur Kleinbuchstaben, Zahlen, _ und Punkt.";
  return null;
}

/** When the username may change again, or null if it may change now. */
export function nextUsernameChange(changedAt: string | null, now: Date): Date | null {
  if (changedAt === null) return null;
  const next = new Date(new Date(changedAt).getTime() + USERNAME_CHANGE_DAYS * DAY_MS);
  return next.getTime() > now.getTime() ? next : null;
}

/** "Du kannst deinen Username in 3 Tagen wieder ändern." (rounded up, at least 1 day). */
export function usernameLockedMessage(next: Date, now: Date): string {
  const days = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / DAY_MS));
  return `Du kannst deinen Username ${days === 1 ? "in 1 Tag" : `in ${days} Tagen`} wieder ändern.`;
}
