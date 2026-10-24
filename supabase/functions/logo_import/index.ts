// Supabase Edge Function: checks an uploaded SVG logo and returns it as a logo spec.
//
// Body: {svg: string (the file's text, at most 200 KB), file_name: string}
// Answer: {spec, suggestions, ignored, source_hash, file_name} or {error, message} (422).
// Nothing is stored here: the dashboard shows the result, the admin assigns the roles and saves
// it with admin_logo_save(), which checks the structure again.
//
// Security
//  * The caller's JWT is checked first (Supabase Auth), then is_admin() (role admin + aal2).
//  * At most 10 calls per admin and hour (admin_logo_import_slot, with the caller's session).
//  * The file is treated as hostile (see _shared/svgImport.ts): own strict reader, no DOCTYPE or
//    entities, only allowed elements and attributes, numbers and transforms limited. Only the
//    normalized structure is returned, never the file's text; errors never quote the file.
//  * No service_role key is needed or used.
//
// Deploy:  npx supabase functions deploy logo_import --use-api

import { createClient } from "npm:@supabase/supabase-js@2";

import { fitViewBox, suggestShapeRoles, validateLogoSpec, type LogoShape } from "../_shared/brandLogoSpec.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { SVG_LIMITS, cleanFileName, importSvg } from "../_shared/svgImport.ts";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
  const token = authorization.slice("Bearer ".length);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json(500, { error: "server_not_configured" });

  // 1) The caller: verified by Supabase Auth, then admin with two-factor (database).
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || userData.user === null) return json(401, { error: "unauthorized" });
  const { data: isAdmin, error: adminError } = await caller.rpc("is_admin");
  if (adminError || isAdmin !== true) return json(403, { error: "forbidden" });

  // 2) Size before reading anything (JSON overhead allowed), then the input.
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > SVG_LIMITS.maxBytes * 2) return json(413, { error: "too_large", message: "Die Datei ist grösser als 200 KB." });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > SVG_LIMITS.maxBytes * 2) return json(413, { error: "too_large", message: "Die Datei ist grösser als 200 KB." });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (typeof body !== "object" || body === null) return json(400, { error: "invalid_body" });
  const input = body as Record<string, unknown>;
  if (typeof input.svg !== "string") return json(400, { error: "invalid_body" });

  // 3) Rate limit (with the caller's session; the database checks the role again).
  const { error: slotError } = await caller.rpc("admin_logo_import_slot");
  if (slotError) {
    return slotError.message === "rate_limited"
      ? json(429, { error: "rate_limited", message: "Höchstens 10 Prüfungen pro Stunde. Bitte später erneut versuchen." })
      : json(403, { error: "forbidden" });
  }

  // 4) Read and check the file.
  const imported = importSvg(input.svg);
  if (!imported.ok) return json(422, { error: imported.code, message: imported.message });
  const shapes = imported.shapes as LogoShape[];
  const viewBox = imported.viewBox ?? fitViewBox(shapes, 0.05);
  if (viewBox === null) return json(422, { error: "no_shapes", message: "Die Datei enthält keine sichtbaren Formen." });
  const checked = validateLogoSpec({ version: 1, viewBox, shapes });
  if (!checked.ok) return json(422, { error: "invalid_logo", message: `Das Logo erfüllt die Regeln nicht: ${checked.error}` });

  return json(200, {
    spec: checked.spec,
    suggestions: suggestShapeRoles(checked.spec, imported.fills),
    ignored: imported.ignored,
    source_hash: await sha256Hex(input.svg),
    file_name: cleanFileName(input.file_name),
  });
});
