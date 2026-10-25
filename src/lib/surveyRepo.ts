import {
  parseOfficialItem,
  parseSurvey,
  type OfficialItem,
  type SurveyForAnswering,
} from "../../shared/surveys";
import { supabase } from "@/lib/supabase";
import { EMPTY_OFFICIAL_FEED, type OfficialFeed } from "@/lib/surveyFeed";
import type { Answers } from "@/lib/surveyFlow";
import { isUsageEnabled } from "@/lib/usage";
import type { Json } from "@/types/database";

/**
 * Surveys and results of the official account. Everything goes through database functions that
 * return only what users may see; the answers are parsed again here and anything unknown is
 * dropped. Images live in the private bucket survey-media (signed, short-lived URLs).
 */

const SURVEY_MEDIA_BUCKET = "survey-media";
/** Short-lived links (10 minutes); they are fetched again when a screen opens. */
const SURVEY_URL_TTL = 10 * 60;

function items(value: unknown): OfficialItem[] {
  return Array.isArray(value) ? value.flatMap((v) => { const item = parseOfficialItem(v); return item === null ? [] : [item]; }) : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Official cards of the feed. Never throws: on any error the feed simply has none. */
export async function fetchOfficialFeed(): Promise<OfficialFeed> {
  try {
    const { data, error } = await supabase.rpc("get_official_feed_items", {});
    if (error) return EMPTY_OFFICIAL_FEED;
    const r = record(data);
    return { top: items(r.top), items: items(r.items) };
  } catch {
    return EMPTY_OFFICIAL_FEED;
  }
}

/** The card was visible for a second: next time it takes its normal place. */
export async function markItemSeen(itemId: string): Promise<void> {
  await supabase.rpc("mark_item_seen", { p_item_id: itemId });
}

/** "Ausblenden": gone from the feed (running surveys stay in the settings). */
export async function dismissItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc("dismiss_item", { p_item_id: itemId });
  if (error) throw error;
}

export type ActiveSurveys = { surveys: OfficialItem[]; results: OfficialItem[]; openCount: number };

/** Settings, "Umfragen": running surveys (open or answered) and recent results. */
export async function fetchActiveSurveys(): Promise<ActiveSurveys> {
  const { data, error } = await supabase.rpc("get_active_surveys", {});
  if (error) throw error;
  const r = record(data);
  const surveys = items(r.surveys);
  return { surveys, results: items(r.results), openCount: surveys.filter((s) => !s.answered).length };
}

/** Number of open surveys for the badge on the settings entry; 0 on any error. */
export async function fetchOpenSurveyCount(): Promise<number> {
  try {
    return (await fetchActiveSurveys()).openCount;
  } catch {
    return 0;
  }
}

export type OfficialProfile = {
  userId: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  bio: string | null;
  surveyCount: number;
  resultsCount: number;
};

/** The official profile: only public fields (never e-mail or other account data). */
export async function fetchOfficialProfile(): Promise<OfficialProfile | null> {
  const { data, error } = await supabase.rpc("get_official_profile", {});
  if (error) throw error;
  const r = record(data);
  if (typeof r.user_id !== "string" || typeof r.username !== "string") return null;
  return {
    userId: r.user_id,
    username: r.username,
    displayName: typeof r.display_name === "string" ? r.display_name : r.username,
    avatarPath: typeof r.avatar_path === "string" ? r.avatar_path : null,
    bio: typeof r.bio === "string" ? r.bio : null,
    surveyCount: typeof r.survey_count === "number" ? r.survey_count : 0,
    resultsCount: typeof r.results_count === "number" ? r.results_count : 0,
  };
}

/** Posts of the official profile, newest first; pass the last published_at for the next page. */
export async function fetchOfficialProfileItems(tab: "surveys" | "results", before: string | null): Promise<OfficialItem[]> {
  const { data, error } = await supabase.rpc("get_official_profile_items", { p_tab: tab, p_before: before, p_limit: 20 });
  if (error) throw error;
  return items(data);
}

/** One official post (results view); null when it isn't visible (any more). */
export async function fetchOfficialItem(itemId: string): Promise<OfficialItem | null> {
  const { data, error } = await supabase.rpc("get_official_item", { p_item_id: itemId });
  if (error) throw error;
  return parseOfficialItem(data);
}

/** A survey for taking part; null when it isn't visible (any more). */
export async function fetchSurvey(surveyId: string): Promise<SurveyForAnswering | null> {
  const { data, error } = await supabase.rpc("get_survey", { p_survey_id: surveyId });
  if (error) throw error;
  return parseSurvey(data);
}

/** Sends the answers (participation and anonymous answers in one transaction). Throws the server's code. */
export async function submitSurvey(surveyId: string, answers: Answers): Promise<void> {
  const { error } = await supabase.rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: answers as Json });
  if (error) throw error;
}

export type SurveyEvent = "card_shown" | "card_opened" | "started" | "dismissed" | "results_shown" | "results_opened" | "profile_tab_opened" | "settings_list_opened";

/**
 * Anonymous statistics of the surveys (daily totals, nothing about the person). Skipped when the
 * usage statistics are switched off in the settings; failures are ignored.
 */
export function trackSurveyEvent(surveyId: string | null, event: SurveyEvent): void {
  if (!isUsageEnabled()) return;
  void Promise.resolve(supabase.rpc("track_survey_event", { p_survey_id: surveyId, p_event: event })).catch(() => undefined);
}

/** Signed URLs of survey images (only for posts the caller may see; the storage policy checks it). */
export async function signSurveyMedia(paths: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return urls;
  const { data, error } = await supabase.storage.from(SURVEY_MEDIA_BUCKET).createSignedUrls(unique, SURVEY_URL_TTL);
  if (error) return urls;
  for (const entry of data) {
    if (entry.path !== null && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}
