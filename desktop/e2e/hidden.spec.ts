import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const evidenceDir = resolve(desktopRoot, "..", ".omo", "evidence");

const PUSH_CHANNEL = "mystatus:push";
const HOUR = 3_600_000;

function fixtureModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: { accounts: 2, green: 2, yellow: 0, red: 0 },
    providers: [
      {
        name: "Anthropic Account Quota",
        minRemaining: 49,
        windows: [{ label: "5-hour limit", remaining: 49, resetMs: 70 * 60 * 1000 }],
      },
      {
        name: "Ollama Cloud",
        minRemaining: 99,
        windows: [{ label: "Session", remaining: 99, resetMs: 60 * 60 * 1000 }],
      },
    ],
    errors: [],
    alerts: [],
    threshold: 25,
    issues: [],
    health: { queried: 2, rendered: 2, stale: 0, failed: 0, unconfigured: 0 },
    ...overrides,
  };
}

function pushPayload(model: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  return { model, fetchedAt: now, nextFetchAt: now + 60_000 };
}

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  // MANDATORY SAFETY GATE: redirect HOME/USERPROFILE so hide/unhide writes to a
  // throwaway mystatus.json, never the developer's real config.
  const home = mkdtempSync(join(tmpdir(), "mystatus-e2e-hidden-"));
  // Core saveConfig writes ~/.config/opencode/mystatus.json without mkdir and
  // swallows ENOENT (mystatus.ts:6744), so seed the dir or hide never persists.
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  app = await _electron.launch({
    args: [join(desktopRoot, "out", "main", "index.js")],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ELECTRON_RENDERER_URL: pathToFileURL(join(desktopRoot, "out", "renderer", "index.html")).href,
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app.close();
});

async function push(model: Record<string, unknown>): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send(args.channel, args.payload);
    },
    { channel: PUSH_CHANNEL, payload: pushPayload(model) },
  );
}

test.describe("hide/show providers", () => {
  test("eye-slash hides a card, Hidden tab lists it, Show restores it", async () => {
    await push(fixtureModel());
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByTestId("provider-card")).toHaveCount(2);
    await expect(page.getByTestId("tab-hidden")).toHaveCount(0);

    // Hide Ollama from the Current tab via its per-card eye-slash button.
    await page.getByTestId("hide-ollama-cloud").click();

    // Card is filtered client-side; the model still carries both providers.
    await expect(page.getByTestId("provider-card")).toHaveCount(1);
    await expect(page.getByTestId("tab-hidden")).toBeVisible();
    await expect(page.getByTestId("tab-hidden-badge")).toHaveText("1");

    // Hidden tab lists the provider with an unhide affordance.
    await page.getByTestId("tab-hidden").click();
    await expect(page.getByTestId("hidden-grid")).toContainText("Ollama Cloud");
    await page.getByTestId("unhide-button").click();

    // Restored: back on Current with both cards, Hidden tab gone.
    await page.getByTestId("tab-current").click();
    await expect(page.getByTestId("provider-card")).toHaveCount(2);
    await expect(page.getByTestId("tab-hidden")).toHaveCount(0);

    await page.waitForTimeout(400);
    await page.screenshot({ path: join(evidenceDir, "task-9-desktop-app.png") });
  });
});

test.describe("issues panel", () => {
  test("collapses four same-reason stale sub-accounts into one row", async () => {
    const issues = [
      { provider: "Google — a@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — b@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — c@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — d@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
    ];
    await push(
      fixtureModel({
        issues,
        health: { queried: 5, rendered: 1, stale: 4, failed: 0, unconfigured: 0 },
      }),
    );

    await page.getByTestId("tab-issues").click();
    await expect(page.getByTestId("issues-panel")).toBeVisible();
    await expect(page.getByTestId("issue-row")).toHaveCount(1);
    await expect(page.getByTestId("issue-provider")).toContainText("Google (4 accounts)");
    await expect(page.getByTestId("issue-status")).toContainText("stale 16h");
    await expect(page.getByTestId("tab-issues-badge")).toHaveText("4");
  });
});
