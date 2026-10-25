import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";
import { MAX_COUNT_PER_EVENT, toBatches } from "@/lib/usageBatches";

/**
 * Anonymous usage statistics: screen views are only counted here on the device and sent as
 * totals (e.g. {"screen_feed": 3}) every 60 seconds and when the app goes to the background.
 * The server stores daily totals per event, nothing about the person. Off = nothing is counted.
 * The setting lives only on this device.
 *
 * Every new screen or feature reports through `track()`; the names must exist in
 * usage_event_types (supabase/schema.sql), unknown names are ignored by the server.
 */
export type UsageEvent =
  | "screen_home"
  | "screen_feed"
  | "screen_post"
  | "screen_comments"
  | "screen_repost"
  | "screen_share"
  | "screen_post_links"
  | "screen_stories"
  | "screen_highlight"
  | "screen_story_create"
  | "screen_camera"
  | "screen_post_create"
  | "screen_chats"
  | "screen_chat"
  | "screen_chat_new"
  | "screen_profile"
  | "screen_user_profile"
  | "screen_follows"
  | "screen_profile_edit"
  | "screen_day"
  | "screen_plan_edit"
  | "screen_plan_editor"
  | "plan_activated"
  | "planned_rest_confirmed"
  | "plan_adopt_opened"
  | "screen_training"
  | "screen_workout_session"
  | "screen_workout_finish"
  | "workout_started"
  | "workout_discarded"
  | "workout_photo_added"
  | "screen_workout_report"
  | "screen_activities"
  | "activity_visibility_changed"
  | "activity_deleted"
  | "screen_training_stats"
  | "training_stats_range_changed"
  | "training_stats_exercise_selected"
  | "profile_tab_posts"
  | "profile_tab_activities"
  | "profile_tab_stats"
  | "profile_tab_reposts"
  | "profile_tab_tagged"
  | "post_like_double_tap"
  | "message_deleted_for_me"
  | "message_deleted_for_all"
  | "chat_background_changed"
  | "chat_background_reset"
  | "chat_cleared_for_me"
  | "plan_deactivated"
  | "plan_days_reordered"
  | "plan_deviation_exception"
  | "plan_deviation_reordered"
  | "plan_round_adjusted"
  | "plan_round_unit_skipped"
  | "screen_plan_round"
  | "screen_search"
  | "screen_hashtag"
  | "screen_settings"
  | "screen_privacy"
  | "screen_blocked"
  | "screen_app_icon"
  | "screen_delete_account"
  | "screen_notifications"
  | "screen_follow_requests"
  | "screen_my_reports"
  | "report_opened"
  | "survey_card_opened"
  | "results_opened";

const STORAGE_KEY = "peakpic.usageStats";
const FLUSH_INTERVAL_MS = 60_000;

let enabled = true;
let pending = new Map<UsageEvent, number>();
const listeners = new Set<() => void>();

/** Counts one use of a screen or feature (only on the device until the next send). */
export function track(event: UsageEvent): void {
  if (!enabled) return;
  pending.set(event, (pending.get(event) ?? 0) + 1);
}

/** Sends what was counted. Failed sends are kept for the next try (bounded). */
export async function flushUsage(): Promise<void> {
  if (!enabled || pending.size === 0) return;
  const { data } = await supabase.auth.getSession();
  if (data.session === null) return;
  const counts = pending;
  pending = new Map();
  for (const batch of toBatches(counts)) {
    const { error } = await supabase.rpc("track_events", { events: batch });
    if (error) {
      // Keep it for later, but never let it grow without bound.
      for (const [event, amount] of Object.entries(batch) as [UsageEvent, number][]) {
        pending.set(event, Math.min((pending.get(event) ?? 0) + amount, MAX_COUNT_PER_EVENT * 4));
      }
    }
  }
}

export function isUsageEnabled(): boolean {
  return enabled;
}

export async function setUsageEnabled(value: boolean): Promise<void> {
  enabled = value;
  if (!value) pending = new Map();
  listeners.forEach((listener) => listener());
  await AsyncStorage.setItem(STORAGE_KEY, value ? "on" : "off").catch(() => undefined);
}

export function useUsageEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => enabled,
  );
}

let started = false;

/** Once at app start: read the setting, then send every 60 s and when going to the background. */
export function startUsageTracking(): void {
  if (started) return;
  started = true;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((value) => {
      enabled = value !== "off";
      if (!enabled) pending = new Map();
      listeners.forEach((listener) => listener());
    })
    .catch(() => undefined);
  setInterval(() => void flushUsage().catch(() => undefined), FLUSH_INTERVAL_MS);
  AppState.addEventListener("change", (state) => {
    if (state !== "active") void flushUsage().catch(() => undefined);
  });
}

/** Counts a screen each time it comes into focus. */
export function useTrackScreen(event: UsageEvent): void {
  useFocusEffect(
    useCallback(() => {
      track(event);
    }, [event]),
  );
}
