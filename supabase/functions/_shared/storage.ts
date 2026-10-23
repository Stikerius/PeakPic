// Shared by the Edge Functions: removing a person's files with the service role client.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
// Upper bound per call; with more files the caller answers "partial" and is simply repeated.
const MAX_FILES_PER_CALL = 20000;

/** All file paths below `${userId}/` in one bucket (folders are listed with id null). */
async function listUserFiles(service: SupabaseClient, bucket: string, userId: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  const folders = [userId];
  while (folders.length > 0 && files.length < limit) {
    const folder = folders.pop() as string;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await service.storage.from(bucket).list(folder, { limit: LIST_PAGE, offset });
      if (error) throw new Error("storage_list_failed");
      for (const entry of data) {
        const path = `${folder}/${entry.name}`;
        if (entry.id === null) folders.push(path);
        else files.push(path);
      }
      if (data.length < LIST_PAGE || files.length >= limit) break;
    }
  }
  return files.slice(0, limit);
}

/** Removes the given paths of one bucket in batches. Paths that are gone already are fine. */
export async function removePaths(service: SupabaseClient, bucket: string, paths: readonly string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await service.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw new Error("storage_remove_failed");
  }
}

/** Deletes the user's files in every bucket. Returns false if more files are left. */
export async function deleteUserFiles(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data: buckets, error } = await service.storage.listBuckets();
  if (error) throw new Error("storage_list_failed");
  let budget = MAX_FILES_PER_CALL;
  for (const bucket of buckets) {
    const files = await listUserFiles(service, bucket.id, userId, budget);
    await removePaths(service, bucket.id, files);
    budget -= files.length;
    if (budget <= 0) return false;
  }
  return true;
}
