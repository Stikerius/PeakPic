import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/** Rest timer after "Satz fertig": on or off and the default length. Stored on the device only. */
export type RestTimerSettings = { enabled: boolean; seconds: number };

const STORAGE_KEY = "peakpic.restTimer";
export const REST_TIMER_CHOICES = [30, 60, 90, 120, 180] as const;
const DEFAULTS: RestTimerSettings = { enabled: true, seconds: 90 };

let settings: RestTimerSettings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw === null) return;
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null && "enabled" in value && "seconds" in value) {
        const { enabled, seconds } = value;
        if (typeof enabled === "boolean" && typeof seconds === "number" && seconds >= 10 && seconds <= 600) {
          settings = { enabled, seconds };
          listeners.forEach((l) => l());
        }
      }
    })
    .catch(() => undefined);
}

export function setRestTimerSettings(next: RestTimerSettings): void {
  settings = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
}

export function useRestTimerSettings(): RestTimerSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      load();
      return () => listeners.delete(listener);
    },
    () => settings,
  );
}
