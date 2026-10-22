import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import { isWorkoutDraft, type WorkoutDraft } from "@/lib/workout";

/**
 * The running training, kept on the device after every change (AsyncStorage), so nothing gets
 * lost when the app is closed or killed. Only one draft at a time. It is removed only after
 * the training was saved on the server or the user confirmed discarding it.
 */
const STORAGE_KEY = "peakpic.trainingDraft.v1";

/** undefined: not loaded yet. */
let current: WorkoutDraft | null | undefined;
let loading: Promise<WorkoutDraft | null> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Loads the stored draft once (later calls get the cached one). */
export function loadTrainingDraft(): Promise<WorkoutDraft | null> {
  if (current !== undefined) return Promise.resolve(current);
  if (loading === null) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        return isWorkoutDraft(parsed) ? parsed : null;
      })
      .catch(() => null)
      .then((draft) => {
        // A draft set meanwhile (e.g. a training started right away) wins.
        if (current === undefined) current = draft;
        emit();
        return current ?? null;
      });
  }
  return loading;
}

/** Replaces the draft and stores it right away. */
export function setTrainingDraft(draft: WorkoutDraft): void {
  current = draft;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft)).catch((error: unknown) =>
    console.warn("[training] Entwurf nicht gespeichert:", error),
  );
}

export function updateTrainingDraft(update: (draft: WorkoutDraft) => WorkoutDraft): void {
  if (current === null || current === undefined) return;
  setTrainingDraft(update(current));
}

/** Only after saving on the server or a confirmed "Verwerfen". */
export async function clearTrainingDraft(): Promise<void> {
  current = null;
  emit();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
}

export function getTrainingDraft(): WorkoutDraft | null | undefined {
  return current;
}

/** The draft (null: none, undefined: still loading). */
export function useTrainingDraft(): WorkoutDraft | null | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (current === undefined) void loadTrainingDraft();
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
