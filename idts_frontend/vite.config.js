import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Writes this build's file list and a build id into dist/sw.js, so the
// service worker caches the whole app on first visit and drops the old
// copy when a new release is deployed.
function serviceWorkerManifest() {
  let outDir = "dist";
  let files = [];
  return {
    name: "idts-sw-manifest",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    generateBundle(_, bundle) {
      files = Object.keys(bundle).filter((f) => !f.endsWith(".map")).map((f) => `/${f}`);
    },
    writeBundle() {
      const swPath = resolve(outDir, "sw.js");
      const buildId = createHash("sha256").update(files.sort().join("|")).digest("hex").slice(0, 12);
      const sw = readFileSync(swPath, "utf8")
        .replace('const BUILD_ID = "dev";', `const BUILD_ID = "${buildId}";`)
        .replace("const BUILD_ASSETS = [];", `const BUILD_ASSETS = ${JSON.stringify(files.filter((f) => f !== "/index.html"))};`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerManifest()],
  server: {
    port: 5173,
  },
});
