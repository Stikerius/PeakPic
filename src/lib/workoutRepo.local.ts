import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  copyIntoPhotoDir,
  deleteLegacyPhotoIndex,
  deletePhotoFile,
  getPhotoUri,
  readLegacyPhotoIndex,
} from "@/lib/photoStorage";
import { toDayKey } from "@/lib/streak";
import type { WorkoutRepo } from "@/lib/workoutRepo";
import type { Workout } from "@/types/workout";

const STORAGE_KEY = "peakpic:workouts:v1";

type StoredWorkout = {
  id: string;
  fileName: string;
  caption: string | null;
  createdAt: string;
};

function isStoredWorkout(value: unknown): value is StoredWorkout {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.fileName === "string" &&
    (typeof v.caption === "string" || v.caption === null) &&
    typeof v.createdAt === "string"
  );
}

function parseStoredWorkouts(value: unknown): StoredWorkout[] {
  return Array.isArray(value) ? value.filter(isStoredWorkout) : [];
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toWorkout(stored: StoredWorkout): Workout {
  return {
    id: stored.id,
    workoutDate: toDayKey(new Date(stored.createdAt)),
    caption: stored.caption,
    createdAt: stored.createdAt,
  };
}

async function writeAll(workouts: StoredWorkout[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
}

async function readAll(): Promise<StoredWorkout[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw !== null) return parseStoredWorkouts(JSON.parse(raw));

  // First run with the repo: adopt photos saved by the earlier camera version.
  const migrated = parseStoredWorkouts(await readLegacyPhotoIndex());
  await writeAll(migrated);
  deleteLegacyPhotoIndex();
  return migrated;
}

/** Device-only backend from phase 2. Not wired up; kept as an offline/dev fallback. */
export const localWorkoutRepo: WorkoutRepo = {
  async listWorkoutDays() {
    return (await readAll()).map((stored) => toWorkout(stored).workoutDate);
  },

  async listWorkoutsOnDay(day) {
    return (await readAll())
      .map((stored) => {
        const photoUrl = getPhotoUri(stored.fileName);
        return { ...toWorkout(stored), photoUrl, photoUrls: photoUrl !== null ? [photoUrl] : [] };
      })
      .filter((workout) => workout.workoutDate === day)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async addWorkout({ sourceUri, caption }) {
    const id = createId();
    const fileName = await copyIntoPhotoDir(sourceUri, id);
    const trimmed = caption.trim();
    const stored: StoredWorkout = {
      id,
      fileName,
      caption: trimmed.length > 0 ? trimmed : null,
      createdAt: new Date().toISOString(),
    };
    await writeAll([stored, ...(await readAll())]);
    return toWorkout(stored);
  },

  async deleteWorkout(id) {
    const all = await readAll();
    const target = all.find((stored) => stored.id === id);
    await writeAll(all.filter((stored) => stored.id !== id));
    if (target !== undefined) deletePhotoFile(target.fileName);
  },
};
