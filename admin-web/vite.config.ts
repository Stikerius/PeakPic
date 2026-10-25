import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from "vite";

/**
 * Writes the Content-Security-Policy into index.html. Only the Supabase project may be contacted;
 * no inline scripts, no third-party scripts. In development Vite injects <style> tags and talks
 * to its dev server over a WebSocket, so only there styles may be inline and ws: is allowed.
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  return {
    name: "peakpic-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const dev = context.server !== undefined;
        let origin: string;
        try {
          origin = new URL(supabaseUrl).origin;
        } catch {
          origin = "";
        }
        const wsOrigin = origin.replace(/^http/, "ws");
        const policy = [
          "default-src 'self'",
          "script-src 'self'",
          `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
          `img-src 'self' data: ${origin}`.trim(),
          `connect-src 'self' ${origin} ${wsOrigin}${dev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`.trim(),
          "font-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-src 'none'",
          "worker-src 'self'",
          "manifest-src 'self'",
        ].join("; ");
        return html.replace("%CSP%", policy);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [contentSecurityPolicy(env.VITE_SUPABASE_URL ?? "")],
    // JSX through Vite's own transform (no React plugin: its dev preamble would be an inline script).
    oxc: { jsx: { runtime: "automatic" } },
    server: {
      port: 5174,
      strictPort: true,
      // The shared brand and survey logic lives next to admin-web (shared/brand, shared/surveys.ts,
      // also used by the app). Only
      // the dev server needs this; the build bundles it. The CSP is not affected.
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL("../shared/brand", import.meta.url)), fileURLToPath(new URL("../shared/surveys.ts", import.meta.url))] },
    },
    build: { sourcemap: false },
  };
});
