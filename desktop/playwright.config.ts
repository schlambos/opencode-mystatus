import { defineConfig, devices } from "@playwright/test";

const projectRoot = process.cwd();

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.1 } },
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "electron",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Playwright's Electron driver launches the built app; the build step runs
  // before this config is used. See e2e/shell.spec.ts (added in todo 4).
  metadata: {
    appPath: `${projectRoot}/out/main/index.js`,
  },
});