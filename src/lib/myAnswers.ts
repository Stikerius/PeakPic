import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Answers } from "@/lib/surveyFlow";

// A copy of one's own survey answers, kept ONLY on this device (per account). The server stores
// answers without any link to the account, so it can't show them back; this copy lets
// "Einstellungen → Umfragen" show them again. Deleting the account clears it (clearLocalData).

/** At most this many surveys are kept; the oldest go first. */
export const OWN_ANSWERS_LIMIT = 50;

export type OwnAnswers = { savedAt: string; answers: Answers };
export type OwnAnswersStore = Record<string, OwnAnswers>;

const keyFor = (userId: string) => `peakpic.ownSurveyAnswers.${userId}`;

/** The stored map, keeping only well-formed entries. */
export function parseOwnAnswersStore(raw: string | null): OwnAnswersStore {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: OwnAnswersStore = {};
    for (const [surveyId, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { savedAt, answers } = entry as Record<string, unknown>;
      if (typeof savedAt !== "string" || typeof answers !== "object" || answers === null || Array.isArray(answers)) continue;
      out[surveyId] = { savedAt, answers: answers as Answers };
    }
    return out;
  } catch {
    return {};
  }
}

/** Adds (or replaces) the answers of one survey and drops the oldest beyond the limit. */
export function withOwnAnswers(store: OwnAnswersStore, surveyId: string, answers: Answers, savedAt: string): OwnAnswersStore {
  const next: OwnAnswersStore = { ...store, [surveyId]: { savedAt, answers } };
  const ids = Object.keys(next).sort((a, b) => (next[b]?.savedAt ?? "").localeCompare(next[a]?.savedAt ?? ""));
  return Object.fromEntries(ids.slice(0, OWN_ANSWERS_LIMIT).map((id) => [id, next[id] as OwnAnswers]));
}

/** Saves the answers just sent (failures are ignored: the copy is only a convenience). */
export async function saveOwnAnswers(userId: string, surveyId: string, answers: Answers): Promise<void> {
  try {
    const store = parseOwnAnswersStore(await AsyncStorage.getItem(keyFor(userId)));
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(withOwnAnswers(store, surveyId, answers, new Date().toISOString())));
  } catch {
    // Nothing to do: the answers were sent; only the copy on this device is missing.
  }
}

/** The answers given on this device, or null. */
export async function loadOwnAnswers(userId: string, surveyId: string): Promise<OwnAnswers | null> {
  try {
    return parseOwnAnswersStore(await AsyncStorage.getItem(keyFor(userId)))[surveyId] ?? null;
  } catch {
    return null;
  }
}
