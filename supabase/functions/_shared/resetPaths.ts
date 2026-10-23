// Pure checks for run_data_reset (no Deno APIs, unit tested in src/lib/__tests__/resetPaths.test.ts).

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Storage paths of one bucket the database may hand out per person and step. */
export const MAX_FILES_PER_PERSON = 20000;
const MAX_PATH_LENGTH = 512;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The files to remove for one person, as returned by admin_reset_apply_user. Only plain paths in
 * that person's own folder are accepted ("{userId}/..."), without "..", duplicates removed. Anything
 * else means the answer is not what the database promised: stop instead of deleting.
 */
export function filesForUser(userId: string, files: unknown): string[] {
  if (!isUuid(userId)) throw new Error("invalid_user");
  if (!Array.isArray(files) || files.length > MAX_FILES_PER_PERSON) throw new Error("invalid_files");
  const prefix = `${userId}/`;
  const result = new Set<string>();
  for (const file of files) {
    if (
      typeof file !== "string" ||
      file.length > MAX_PATH_LENGTH ||
      !file.startsWith(prefix) ||
      file.length === prefix.length ||
      file.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error("invalid_files");
    }
    result.add(file);
  }
  return [...result];
}

/** Known error codes of the admin_reset_* functions (anything else is reported as "failed"). */
export const RESET_ERRORS = [
  "not_authorized",
  "job_not_found",
  "not_job_owner",
  "job_wrong_state",
  "full_reset_disabled",
  "other_job_active",
] as const;

export function resetErrorCode(message: string | undefined): string {
  return RESET_ERRORS.find((code) => code === message) ?? "failed";
}
