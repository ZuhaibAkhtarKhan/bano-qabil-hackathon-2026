import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

mkdirSync(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: {
    background: "src/background/service-worker.ts",
    content: "src/content/content.ts",
    bridge: "src/bridge/bridge.ts",
    popup: "src/popup/popup.ts",
    options: "src/options/options.ts",
  },
  bundle: true,
  format: "esm",
  target: "chrome114",
  outdir: dist,
  sourcemap: true,
  logLevel: "info",
});

for (const file of ["manifest.json", "src/popup/popup.html", "src/popup/popup.css", "src/options/options.html"]) {
  const from = path.join(root, file);
  const to = path.join(dist, path.basename(file) === "manifest.json" ? "manifest.json" : path.basename(file));
  copyFileSync(from, to);
}

cpSync(path.join(root, "icons"), path.join(dist, "icons"), { recursive: true });

console.info("Extension written to dist/. Load unpacked from apps/extension/dist");
