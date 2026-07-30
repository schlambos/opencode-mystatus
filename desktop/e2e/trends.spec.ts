import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const evidenceDir = resolve(desktopRoot, "..", ".omo", "evidence");
const PUSH_CHANNEL = "mystatus:push";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SEED_TS = Date.now();

// History keys MUST be "<provider.name>::<window.label>" — the core's
// `${cellTitle}::${label}` convention (plugin/mystatus.ts:7046), with both
// halves passed verbatim into the view model (mystatus.ts:7370/7374).
function seedHistory(): Record<string, unknown> {
  return {
    version: 1,
    snapshots: [
      { ts: SEED_TS - 3 * HOUR, values: { "MiniMax Token Plan::5-hour": 60 } },
      {
        ts: SEED_TS - 2 * HOUR,
        values: {
          "Anthropic Account Quota::7-day limit": 75,
          "MiniMax Token Plan::5-hour": 30,
          "Ollama Cloud::Session": 100,
        },
      },
      { ts: SEED_TS - HOUR, values: { "MiniMax Token Plan::5-hour": 12 } },
    ],
  };
}

function fixturePayload(): Record<string, unknown> {
  const now = Date.now();
  return {
    model: {
      summary: {
        accounts: 3,
        green: 2,
        yellow: 1,
        red: 1,
        lowest: { provider: "MiniMax Token Plan", label: "5-hour", remaining: 3 },
        soonest: { provider: "Ollama Cloud", label: "Session", resetMs: HOUR },
      },
      providers: [
        {
          name: "MiniMax Token Plan",
          minRemaining: 3,
          windows: [{ label: "5-hour", remaining: 3, resetMs: HOUR }],
        },
        {
          name: "Anthropic Account Quota",
          minRemaining: 49,
          windows: [
            { label: "5-hour limit", remaining: 49, resetMs: 70 * 60_000 },
            { label: "7-day limit", remaining: 72, resetMs: 4 * DAY },
          ],
        },
        {
          name: "Ollama Cloud",
          minRemaining: 99,
          windows: [{ label: "Session", remaining: 99, resetMs: HOUR }],
        },
      ],
      errors: [],
      alerts: ["MiniMax Token Plan · 5-hour: 3%"],
      threshold: 25,
      issues: [],
      health: { queried: 3, rendered: 3, stale: 0, failed: 0, unconfigured: 0 },
    },
    fetchedAt: now,
    nextFetchAt: now + 60_000,
  };
}

let app: ElectronApplication;
let page: Page;
let historyPath: string;

test.beforeAll(async () => {
  // MANDATORY SAFETY GATE: HOME/USERPROFILE point at a throwaway dir so the
  // seeded history — and anything the core reads — never touches real config.
  const home = mkdtempSync(join(tmpdir(), "mystatus-trends-e2e-"));
  const configDir = join(home, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  historyPath = join(configDir, "mystatus-history.json");
  writeFileSync(historyPath, JSON.stringify(seedHistory()));
  writeFileSync(join(configDir, "mystatus.json"), JSON.stringify({ trend: "full" }));

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

async function pushToRenderer(payload: unknown): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send(args.channel, args.payload);
    },
    { channel: PUSH_CHANNEL, payload },
  );
}

test.describe("trend sparklines and live countdowns", () => {
  test("seeded history renders sparklines with per-point colors, deltas, and projections", async () => {
    await pushToRenderer(fixturePayload());

    const panel = page.getByTestId("trend-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("full"); // trend mode from seeded mystatus.json
    await expect(panel).toContainText("3 snapshots");
    await expect(page.getByTestId("sparkline").first()).toBeVisible();

    // Anthropic 7-day: 75 → 72 over 2h ⇒ ▼3%/2h, ~2d to empty (48h < 4d reset).
    const anthropic = page.getByTestId("trend-window-row").filter({ hasText: "7-day limit" });
    await expect(anthropic.getByTestId("trend-delta")).toHaveText("\u25bc3%/2h");
    await expect(anthropic.getByTestId("trend-projection")).toHaveText("~2d to empty");
    await expect(anthropic.getByTestId("reset-countdown")).toContainText("3d 23h");

    // MiniMax 5-hour: [60, 30, 12] + live 3 ⇒ green/yellow/red/red points,
    // ▼9%/1h, ~20m to empty (20m < 1h reset).
    const minimax = page.getByTestId("trend-window-row").filter({ hasText: "\u25bc9%/1h" });
    expect(await minimax.locator(".fill-status-ok").count()).toBe(1);
    expect(await minimax.locator(".fill-status-warn").count()).toBe(1);
    expect(await minimax.locator(".fill-status-dead").count()).toBe(2);
    await expect(minimax.getByTestId("trend-projection")).toHaveText("~20m to empty");
    await expect(minimax.getByTestId("reset-countdown")).toContainText("59m");

    // Ollama Session: 100 → 99 over 2h ⇒ ▼1%/2h, but depletion (198h) is
    // slower than the 1h reset ⇒ core suppresses the projection.
    const ollama = page.getByTestId("trend-window-row").filter({ hasText: "Session" });
    await expect(ollama.getByTestId("trend-delta")).toHaveText("\u25bc1%/2h");
    await expect(ollama.getByTestId("trend-projection")).toHaveCount(0);

    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(evidenceDir, "task-7-desktop-app.png") });
  });

  test("malformed history degrades to no trend rows instead of crashing", async () => {
    writeFileSync(historyPath, "{{{{ definitely not json");
    await pushToRenderer(fixturePayload());

    await expect(page.getByTestId("trend-empty-hint")).toBeVisible();
    await expect(page.getByTestId("sparkline")).toHaveCount(0);
    // Shell chrome survives the corrupt file; the dashboard still renders.
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("pane-dashboard")).toBeVisible();

    await page.screenshot({ path: join(evidenceDir, "task-7-desktop-app-fail.png") });
  });
});
