import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

/** Every file under public/, as paths relative to the site root. */
function publicFiles(dir = "public", root = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? publicFiles(full, root) : [relative(root, full)];
  });
}

/**
 * Emit sw.js with the exact list of files this build produced, and a version
 * derived from them. Done here rather than with a plugin dependency because it
 * is thirty lines and the app otherwise has almost none.
 */
function serviceWorker() {
  return {
    name: "chess-lab-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const files = [
        "./",
        ...Object.keys(bundle).filter((f) => !f.endsWith(".map")),
        ...publicFiles(),
      ];
      const unique = [...new Set(files)].sort();
      // Built asset names carry content hashes, so hashing the list is enough
      // to give every distinct build its own cache.
      const version = createHash("sha256").update(unique.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync("pwa/service-worker.js", "utf8")
        .replace('"__VERSION__"', JSON.stringify(version))
        .replace("__PRECACHE__", JSON.stringify(unique));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// base: "./" makes asset URLs relative, so the build works when served from
// a GitHub Pages project site (https://user.github.io/repo/) and from inside
// the native app's web view alike.
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
});
