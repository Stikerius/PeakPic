// Web build of the app (npm run web:build): exports the app as a single-page app into dist-web/,
// adds the WebAssembly file of the photo editor and checks the result. Fails when a secret key
// or inline code shows up. Doesn't touch the Expo dev server for Expo Go.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { findInlineCode, findSecrets } from "../shared/webBuild.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-web");

// One fixed command string (no user input); a shell is needed for npx on Windows.
const exported = spawnSync("npx expo export --platform web --output-dir dist-web", { cwd: root, stdio: "inherit", shell: true });
if (exported.status !== 0) process.exit(exported.status ?? 1);

// CanvasKit (Skia) for the photo editor, loaded on demand from /canvaskit.wasm.
copyFileSync(join(root, "node_modules/canvaskit-wasm/bin/full/canvaskit.wasm"), join(out, "canvaskit.wasm"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
// 1. The built files: no secret keys.
for (const file of walk(out).filter((f) => /\.(js|html|json|css|map|txt)$/.test(f))) {
  for (const finding of findSecrets(readFileSync(file, "utf8"))) problems.push(`${relative(root, file)}: ${finding}`);
}
// 2. The page: no inline scripts, styles or handlers.
for (const finding of findInlineCode(readFileSync(join(out, "index.html"), "utf8"))) problems.push(`dist-web/index.html: ${finding}`);
// 3. The app's own source: no secret keys either.
for (const dir of ["src", "public"]) {
  for (const file of walk(join(root, dir)).filter((f) => /\.(ts|tsx|js|mjs|json|html|css)$/.test(f) && !f.includes("__tests__"))) {
    for (const finding of findSecrets(readFileSync(file, "utf8"))) problems.push(`${relative(root, file)}: ${finding}`);
  }
}
for (const file of ["app.json", "package.json"]) {
  for (const finding of findSecrets(readFileSync(join(root, file), "utf8"))) problems.push(`${file}: ${finding}`);
}

const scripts = walk(join(out, "_expo")).filter((f) => f.endsWith(".js"));
const raw = scripts.reduce((n, f) => n + statSync(f).size, 0);
const zipped = scripts.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
console.log(`\nWeb-Build: ${scripts.length} Skript-Dateien, ${(raw / 1e6).toFixed(2)} MB (gzip ${(zipped / 1e6).toFixed(2)} MB)`);
console.log(`CanvasKit: ${existsSync(join(out, "canvaskit.wasm")) ? "vorhanden" : "FEHLT"}`);
if (problems.length > 0) {
  console.error("\nPrüfung fehlgeschlagen:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("Prüfung: keine geheimen Schlüssel, keine Inline-Skripte oder -Stile. Starten mit: npm run web:serve");
