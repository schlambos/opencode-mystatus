import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..", "plugin");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "~core": resolve(pluginRoot, "mystatus.ts"),
      "~core/": `${pluginRoot}/`,
    },
  },
});