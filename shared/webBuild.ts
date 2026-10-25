// The web build of the app (docs/app-ansicht.md): its security headers, the check of the built
// bundle and safe file paths for the serving script. Plain TypeScript without imports, so Node
// runs it directly (scripts/web-build.mjs, scripts/serve-web.mjs) and Jest tests it.

/** Port of the web app (the dashboard runs on 5174, the Expo dev server on 8081). */
export const WEB_APP_PORT = 8088;

/** Where the dashboard runs locally; only these may embed the web app (frame-ancestors). */
export const DEFAULT_FRAME_ANCESTORS = ["http://localhost:5174", "http://127.0.0.1:5174"];

/**
 * react-native-web creates an empty <style> element and fills it through the CSSOM (insertRule).
 * This hash (of the empty text) allows exactly that empty element, no inline style with content.
 */
export const EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/;

/** The https and wss origin of the Supabase project, or null for anything that isn't one. */
export function supabaseOrigins(url: string | null | undefined): { https: string; wss: string } | null {
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
  if (!/^[a-z0-9.-]+$/.test(parsed.hostname)) return null;
  const host = parsed.port === "" ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
  return { https: `https://${host}`, wss: `wss://${host}` };
}

/** Origins allowed to embed the web app: space separated, each a plain http(s) origin. */
export function parseFrameAncestors(value: string | null | undefined): string[] {
  if (typeof value !== "string" || value.trim() === "") return [...DEFAULT_FRAME_ANCESTORS];
  const list = value.trim().split(/\s+/);
  if (list.some((o) => !ORIGIN.test(o))) throw new Error("WEB_APP_FRAME_ANCESTORS: nur Ursprünge wie https://admin.example.ch");
  return list;
}

/**
 * The Content-Security-Policy of the web app: scripts only from its own origin (plus WebAssembly
 * for the photo editor), styles only from its own origin and the empty style element, network
 * only to its own origin and the Supabase project (https and wss), pictures from its own origin,
 * Supabase storage and small data/blob pictures, no plugins, no frames inside, embedding only by
 * the dashboard. Without a Supabase URL the wildcard for Supabase projects is used.
 */
export function webAppCsp(options: { supabaseUrl: string | null | undefined; frameAncestors: string[] }): string {
  const supabase = supabaseOrigins(options.supabaseUrl);
  const https = supabase?.https ?? "https://*.supabase.co";
  const wss = supabase?.wss ?? "wss://*.supabase.co";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `style-src 'self' ${EMPTY_STYLE_HASH}`,
    `img-src 'self' data: blob: ${https}`,
    "media-src 'self' blob:",
    `connect-src 'self' ${https} ${wss} blob: data:`,
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    `frame-ancestors ${options.frameAncestors.join(" ")}`,
  ].join("; ");
}

/** All headers of every response of the web app. */
export function webAppHeaders(options: { supabaseUrl: string | null | undefined; frameAncestors: string[] }): Record<string, string> {
  return {
    "Content-Security-Policy": webAppCsp(options),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  };
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
};

export function contentTypeFor(path: string): string | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return TYPES[ext] ?? null;
}

/** Hashed build files never change (a year); everything else is checked every time. */
export function cacheControlFor(path: string): string {
  return /^_expo\/static\//.test(path) || /^assets\//.test(path) ? "public, max-age=31536000, immutable" : "no-cache";
}

/**
 * The file a request path points to, relative to the build folder, or null when it leaves it
 * (.., encoded slashes, backslashes, null bytes, hidden files). "" stands for index.html.
 */
export function safeStaticPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) return null;
  const parts = decoded.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === ".." || p === "." || p.startsWith("."))) return null;
  return parts.join("/");
}

/** A path of the single-page app (no file extension): answered with index.html. */
export function isAppRoute(path: string): boolean {
  return path === "" || !/\.[a-z0-9]{1,5}$/i.test(path);
}

function base64UrlDecode(part: string): string {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    return "";
  }
}

/**
 * Secret keys in a text (built bundle or source): the word service_role, JWTs whose role is
 * service_role, Supabase secret keys (sb_secret_ with a value). The publishable key and the
 * anon JWT are public and allowed. Returns a short label per finding, never the value.
 */
export function findSecrets(text: string): string[] {
  const found: string[] = [];
  if (text.includes("service_role")) found.push("service_role");
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    const payload = base64UrlDecode(match[1] ?? "");
    if (/"role"\s*:\s*"(service_role|supabase_admin)"/.test(payload)) found.push("jwt_service_role");
  }
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) found.push("sb_secret_key");
  return found;
}

/** Inline scripts, inline styles with content and inline event handlers in an HTML page. */
export function findInlineCode(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(m[1] ?? "") || (m[2] ?? "").trim() !== "") found.push("inline_script");
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if ((m[1] ?? "").trim() !== "") found.push("inline_style");
  }
  if (/\son[a-z]+\s*=/i.test(html)) found.push("inline_handler");
  if (/\sstyle\s*=/i.test(html)) found.push("style_attribute");
  return found;
}
