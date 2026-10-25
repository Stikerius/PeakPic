import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_FRAME_ANCESTORS,
  EMPTY_STYLE_HASH,
  cacheControlFor,
  contentTypeFor,
  findInlineCode,
  findSecrets,
  isAppRoute,
  parseFrameAncestors,
  safeStaticPath,
  supabaseOrigins,
  webAppCsp,
  webAppHeaders,
} from "../../../shared/webBuild";
import { keyAction } from "@/lib/webKeys";
import { dismissButton, orderedButtons, toDialog } from "@/lib/webDialogs";

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2lnbmF0dXJlc2lnbmF0dXJl`;

describe("web app headers", () => {
  const csp = webAppCsp({ supabaseUrl: "https://abcxyz.supabase.co", frameAncestors: ["http://localhost:5174"] });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

  it("scripts and styles only from its own origin, no unsafe-inline or unsafe-eval", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(directive("style-src")).toBe(`style-src 'self' ${EMPTY_STYLE_HASH}`);
    expect(csp).not.toMatch(/unsafe-inline|'unsafe-eval'/);
  });

  it("network only to its own origin and exactly the Supabase project (https and wss)", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://abcxyz.supabase.co wss://abcxyz.supabase.co blob: data:");
    expect(directive("img-src")).toBe("img-src 'self' data: blob: https://abcxyz.supabase.co");
  });

  it("no plugins, no frames inside, embedding only by the dashboard", () => {
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("frame-src")).toBe("frame-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors http://localhost:5174");
  });

  it("the other headers", () => {
    const headers = webAppHeaders({ supabaseUrl: null, frameAncestors: DEFAULT_FRAME_ANCESTORS });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toContain("camera=(self)");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    // Without a project URL: the Supabase wildcard, never "*".
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
  });

  it("the Supabase URL must be a plain https origin", () => {
    expect(supabaseOrigins("https://abc.supabase.co/")).toEqual({ https: "https://abc.supabase.co", wss: "wss://abc.supabase.co" });
    expect(supabaseOrigins("http://abc.supabase.co")).toBeNull();
    expect(supabaseOrigins("https://user:pw@abc.supabase.co")).toBeNull();
    expect(supabaseOrigins("javascript:alert(1)")).toBeNull();
    expect(supabaseOrigins(undefined)).toBeNull();
  });

  it("frame-ancestors: defaults, plain origins only", () => {
    expect(parseFrameAncestors(undefined)).toEqual(DEFAULT_FRAME_ANCESTORS);
    expect(parseFrameAncestors("https://admin.example.ch")).toEqual(["https://admin.example.ch"]);
    expect(() => parseFrameAncestors("*")).toThrow();
    expect(() => parseFrameAncestors("https://admin.example.ch/path")).toThrow();
    expect(() => parseFrameAncestors("https://a.ch 'self'")).toThrow();
  });
});

describe("serving files", () => {
  it("never leaves the build folder", () => {
    expect(safeStaticPath("/")).toBe("");
    expect(safeStaticPath("/_expo/static/js/web/entry.js?x=1")).toBe("_expo/static/js/web/entry.js");
    expect(safeStaticPath("/../secret")).toBeNull();
    expect(safeStaticPath("/%2e%2e/secret")).toBeNull();
    expect(safeStaticPath("/a/..%2f..%2fsecret")).toBeNull();
    expect(safeStaticPath("/..\\secret")).toBeNull();
    expect(safeStaticPath("/.env")).toBeNull();
    expect(safeStaticPath("/a%00b")).toBeNull();
    expect(safeStaticPath("/%E0%A4%A")).toBeNull();
  });

  it("app paths get index.html, files their type and caching", () => {
    expect(isAppRoute("")).toBe(true);
    expect(isAppRoute("user/123")).toBe(true);
    expect(isAppRoute("favicon.ico")).toBe(false);
    expect(contentTypeFor("canvaskit.wasm")).toBe("application/wasm");
    expect(contentTypeFor("x.exe")).toBeNull();
    expect(cacheControlFor("_expo/static/js/web/entry-abc.js")).toContain("immutable");
    expect(cacheControlFor("index.html")).toBe("no-cache");
  });
});

describe("bundle check", () => {
  it("finds secret keys, not the public ones", () => {
    expect(findSecrets(`const key = "${jwt({ role: "anon", iss: "supabase" })}"`)).toEqual([]);
    expect(findSecrets('const key = "sb_publishable_abcdefghijklmnopqrstuvwxyz"')).toEqual([]);
    // supabase-js only checks the prefix; that is no key.
    expect(findSecrets('e.startsWith("sb_publishable_")||e.startsWith("sb_secret_")')).toEqual([]);
    expect(findSecrets(`x="${jwt({ role: "service_role" })}"`)).toContain("jwt_service_role");
    expect(findSecrets('x="sb_secret_abcdefghijklmnopqrstu"')).toContain("sb_secret_key");
    expect(findSecrets("SUPABASE_SERVICE_ROLE_KEY=service_role")).toContain("service_role");
  });

  it("finds inline code in the page", () => {
    expect(findInlineCode('<script src="/a.js" defer></script><link rel="stylesheet" href="/r.css">')).toEqual([]);
    expect(findInlineCode("<script>alert(1)</script>")).toContain("inline_script");
    expect(findInlineCode("<style>body{}</style>")).toContain("inline_style");
    expect(findInlineCode('<img src="x" onerror="alert(1)">')).toContain("inline_handler");
    expect(findInlineCode('<div style="color:red"></div>')).toContain("style_attribute");
    expect(findInlineCode('<style id="x"></style>')).toEqual([]);
  });
});

describe("web dialogs (Alert.alert in the browser)", () => {
  it("buttons, cancel last, Escape picks cancel", () => {
    const pressed: string[] = [];
    const dialog = toDialog("Beitrag löschen?", "Das kann nicht rückgängig gemacht werden.", [
      { text: "Abbrechen", style: "cancel", onPress: () => pressed.push("cancel") },
      { text: "Löschen", style: "destructive", onPress: () => pressed.push("delete") },
    ]);
    expect(orderedButtons(dialog).map((b) => b.text)).toEqual(["Löschen", "Abbrechen"]);
    dismissButton(dialog)?.onPress?.();
    expect(pressed).toEqual(["cancel"]);
  });

  it("no buttons: one OK; several without cancel: Escape does nothing", () => {
    expect(toDialog("Hinweis", undefined, undefined).buttons.map((b) => b.text)).toEqual(["OK"]);
    expect(dismissButton(toDialog("Hinweis", "", []))?.text).toBe("OK");
    expect(dismissButton(toDialog("Wählen", null, [{ text: "A" }, { text: "B" }]))).toBeNull();
    expect(toDialog(42, 7, [{ text: "", style: "weird" }])).toMatchObject({ title: "", message: null, buttons: [{ text: "OK", style: "default" }] });
  });
});

describe("keyboard shortcuts (web)", () => {
  const map = { ArrowRight: () => undefined, Escape: () => undefined };
  const info = { altKey: false, ctrlKey: false, metaKey: false, editable: false };
  it("only plain keys outside of fields", () => {
    expect(keyAction({ ...info, key: "ArrowRight" }, map)).toBe(map.ArrowRight);
    expect(keyAction({ ...info, key: "ArrowRight", editable: true }, map)).toBeNull();
    expect(keyAction({ ...info, key: "ArrowRight", ctrlKey: true }, map)).toBeNull();
    expect(keyAction({ ...info, key: "x" }, map)).toBeNull();
  });
});
