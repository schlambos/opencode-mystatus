import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const pluginRoot = resolve(here, "..", "plugin");
const coreEntry = resolve(pluginRoot, "mystatus.ts");

// @opencode-ai/plugin is ESM-only and is a real runtime dependency of the
// packaged app. It MUST survive electron-builder packaging and MUST NOT be
// bundled into the main-process output (a CJS bundle would `require()` it and
// crash with ERR_REQUIRE_ESM). Keep it external so the built ESM main imports
// it from node_modules at runtime.
const externalized = ["@opencode-ai/plugin"];

const coreAlias = {
  "~core": coreEntry,
  "~core/": `${pluginRoot}/`,
};

const esmOutput = {
  format: "es" as const,
  entryFileNames: "[name].js",
  chunkFileNames: "chunks/[name]-[hash].js",
  assetFileNames: "assets/[name][extname]",
};

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(here, "src/main/index.ts") },
        external: externalized,
        output: esmOutput,
      },
    },
    resolve: { alias: coreAlias },
  },
  // Sandboxed renderers (webPreferences.sandbox: true) can only execute
  // CommonJS preload scripts — ESM preloads require sandbox: false
  // (https://www.electronjs.org/docs/latest/tutorial/esm). We keep the
  // sandbox, so the preload is the one target built as CJS.
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(here, "src/preload/index.ts") },
        external: externalized,
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
    resolve: { alias: coreAlias },
  },
  renderer: {
    root: resolve(here, "src/renderer"),
    build: {
      rollupOptions: {
        input: { index: resolve(here, "src/renderer/index.html") },
      },
    },
    resolve: { alias: coreAlias },
    plugins: [react(), tailwindcss()],
  },
});