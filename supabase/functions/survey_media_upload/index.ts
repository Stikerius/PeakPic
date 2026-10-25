// Supabase Edge Function: images of surveys (bucket survey-media, private).
//
// Body (JSON):
//   {action: "upload", survey_id, scope: "survey"|"results", alt_text, file_name, data: base64}
//     -> {id, path, width, height}
//   {action: "delete", media_id} -> {deleted: true}
// After every call, files in the bucket that no survey registers (older than 10 minutes) are
// removed ("nicht registrierte Objekte werden beim nächsten Admin-Aufruf bereinigt").
//
// Security
//  * The caller's JWT is checked first (Supabase Auth), then is_admin() (role admin + aal2).
//  * Every database step runs with the caller's session (the functions check the role again,
//    the limits and the survey); only writing and deleting files uses the service role, because
//    clients have no write rights on the bucket at all.
//  * The image is checked by its bytes (_shared/surveyImage.ts): PNG, JPEG or WebP, at most 2 MB
//    and 1600 pixels per side; SVG and everything else is refused. The stored path is random
//    (survey/{survey_id}/{scope}-{uuid}.{ext}); the original file name is neither used nor stored.
//    The dashboard scales and re-encodes images in the browser first (removes EXIF data).
//
// Deploy:  npx supabase functions deploy survey_media_upload --use-api

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { corsHeaders, json } from "../_shared/http.ts";
import { SURVEY_IMAGE_LIMITS, checkSurveyImage, cleanAltText, decodeBase64 } from "../_shared/surveyImage.ts";

const BUCKET = "survey-media";
const ORPHAN_AGE_MS = 10 * 60 * 1000;
const MAX_FOLDERS_PER_CALL = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Removes files below survey/ that are not registered in survey_media (and old enough). */
async function removeOrphans(caller: SupabaseClient, service: SupabaseClient): Promise<number> {
  const { data: registered, error } = await caller.rpc("admin_survey_media_paths");
  if (error || !Array.isArray(registered)) return 0;
  const known = new Set(registered.filter((p): p is string => typeof p === "string"));
  const { data: folders, error: listError } = await service.storage.from(BUCKET).list("survey", { limit: MAX_FOLDERS_PER_CALL });
  if (listError) return 0;
  const orphans: string[] = [];
  for (const folder of folders ?? []) {
    if (folder.id !== null || !UUID.test(folder.name)) continue;
    const { data: files } = await service.storage.from(BUCKET).list(`survey/${folder.name}`, { limit: 100 });
    for (const file of files ?? []) {
      const path = `survey/${folder.name}/${file.name}`;
      const created = Date.parse(file.created_at ?? "");
      if (!known.has(path) && Number.isFinite(created) && Date.now() - created > ORPHAN_AGE_MS) orphans.push(path);
    }
  }
  if (orphans.length > 0) await service.storage.from(BUCKET).remove(orphans);
  return orphans.length;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
  const token = authorization.slice("Bearer ".length);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "server_not_configured" });

  // 1) The caller: verified by Supabase Auth, then admin with two-factor (database).
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || userData.user === null) return json(401, { error: "unauthorized" });
  const { data: isAdmin, error: adminError } = await caller.rpc("is_admin");
  if (adminError || isAdmin !== true) return json(403, { error: "forbidden" });

  // 2) Size before reading (base64 and JSON overhead allowed), then the input.
  const maxBody = Math.ceil((SURVEY_IMAGE_LIMITS.maxBytes * 4) / 3) + 4096;
  if (Number(request.headers.get("Content-Length") ?? "0") > maxBody) return json(413, { error: "too_large", message: "Das Bild ist grösser als 2 MB." });
  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > maxBody) return json(413, { error: "too_large", message: "Das Bild ist grösser als 2 MB." });
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return json(400, { error: "invalid_body" });
    input = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (input.action === "delete") {
    if (typeof input.media_id !== "string" || !UUID.test(input.media_id)) return json(400, { error: "invalid_body" });
    const { data: path, error } = await caller.rpc("admin_survey_media_remove", { p_media_id: input.media_id });
    if (error) return json(409, { error: error.message });
    if (typeof path === "string") await service.storage.from(BUCKET).remove([path]);
    await removeOrphans(caller, service);
    return json(200, { deleted: true });
  }

  if (input.action !== "upload") return json(400, { error: "invalid_action" });
  const surveyId = input.survey_id;
  const scope = input.scope;
  if (typeof surveyId !== "string" || !UUID.test(surveyId) || (scope !== "survey" && scope !== "results")) return json(400, { error: "invalid_body" });
  const altText = cleanAltText(input.alt_text);
  if (altText === null) return json(422, { error: "invalid_alt_text", message: "Bitte einen Alternativtext mit 1 bis 140 Zeichen angeben." });
  const bytes = decodeBase64(input.data);
  if (bytes === null) return json(422, { error: "invalid_image", message: "Die Datei konnte nicht gelesen werden." });
  const checked = checkSurveyImage(bytes);
  if (!checked.ok) return json(422, { error: checked.code, message: checked.message });
  const { info } = checked;

  // 3) A path from the database (checks the survey and the limit with the caller's session).
  const { data: path, error: slotError } = await caller.rpc("admin_survey_media_slot", { p_survey_id: surveyId, p_scope: scope, p_ext: info.ext });
  if (slotError || typeof path !== "string") return json(409, { error: slotError?.message ?? "slot_failed" });

  // 4) Store the file, then register it; if registering fails, the file goes again.
  const { error: uploadError } = await service.storage.from(BUCKET).upload(path, bytes, { contentType: info.mime, upsert: false });
  if (uploadError) return json(500, { error: "upload_failed" });
  const { data: mediaId, error: registerError } = await caller.rpc("admin_survey_media_register", {
    p_survey_id: surveyId,
    p_scope: scope,
    p_path: path,
    p_alt_text: altText,
    p_width: info.width,
    p_height: info.height,
    p_bytes: bytes.length,
  });
  if (registerError) {
    await service.storage.from(BUCKET).remove([path]);
    return json(409, { error: registerError.message });
  }
  await removeOrphans(caller, service);
  return json(200, { id: mediaId, path, width: info.width, height: info.height });
});
