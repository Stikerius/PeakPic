// Serves the web build (dist-web/) on its own origin with the security headers of
// shared/webBuild.ts (npm run web:serve). Only GET and HEAD, only files inside dist-web, every
// app path gets index.html. Logs method, path (without query) and status, never headers or tokens.
//   EXPO_PUBLIC_SUPABASE_URL   from .env (connect-src and img-src of the CSP)
//   WEB_APP_FRAME_ANCESTORS    who may embed the app (default: the dashboard on localhost:5174)
//   WEB_APP_PORT               default 8088
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

import {
  WEB_APP_PORT,
  cacheControlFor,
  contentTypeFor,
  isAppRoute,
  parseFrameAncestors,
  safeStaticPath,
  webAppHeaders,
} from "../shared/webBuild.ts";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", "dist-web"));
if (!existsSync(join(root, "index.html"))) {
  console.error("dist-web/index.html fehlt. Zuerst: npm run web:build");
  process.exit(1);
}
const port = Number(process.env.WEB_APP_PORT ?? WEB_APP_PORT);
const headers = webAppHeaders({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  frameAncestors: parseFrameAncestors(process.env.WEB_APP_FRAME_ANCESTORS),
});
const COMPRESSIBLE = /\.(js|css|html|json|svg|ttf|wasm|txt)$/;

function send(res, status, extra = {}) {
  res.writeHead(status, { ...headers, "Content-Type": "text/plain; charset=utf-8", ...extra });
  res.end(status === 404 ? "Nicht gefunden" : status === 405 ? "Nicht erlaubt" : "Ungültige Anfrage");
}

function handle(req, res) {
  const method = req.method ?? "GET";
  const path = safeStaticPath(req.url ?? "/");
  const done = (status) => console.log(`${method} ${(req.url ?? "/").split("?")[0]} ${status}`);
  if (method !== "GET" && method !== "HEAD") {
    done(405);
    return send(res, 405, { Allow: "GET, HEAD" });
  }
  if (path === null) {
    done(400);
    return send(res, 400);
  }
  const relativePath = isAppRoute(path) ? "index.html" : path;
  let file;
  try {
    file = realpathSync(join(root, relativePath));
  } catch {
    done(404);
    return send(res, 404);
  }
  if (!(file === root || file.startsWith(root + sep)) || !statSync(file).isFile()) {
    done(404);
    return send(res, 404);
  }
  const gzip = COMPRESSIBLE.test(file) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  res.writeHead(200, {
    ...headers,
    "Content-Type": contentTypeFor(relativePath) ?? "application/octet-stream",
    "Cache-Control": cacheControlFor(relativePath),
    Vary: "Accept-Encoding",
    ...(gzip ? { "Content-Encoding": "gzip" } : { "Content-Length": String(statSync(file).size) }),
  });
  done(200);
  if (method === "HEAD") return res.end();
  const stream = createReadStream(file);
  (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
}

// Only on this computer (IPv4 and IPv6 localhost), never in the network.
for (const host of ["127.0.0.1", "::1"]) {
  createServer(handle)
    .on("error", (error) => {
      if (host === "::1") return; // no IPv6 on this machine
      console.error(error.message);
      process.exit(1);
    })
    .listen(port, host, () => {
      if (host === "127.0.0.1") console.log(`Web-App: http://localhost:${port} (Einbettung erlaubt für ${headers["Content-Security-Policy"].split("frame-ancestors ")[1]})`);
    });
}
