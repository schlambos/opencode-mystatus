import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const evidenceDir = resolve(desktopRoot, "..", ".omo", "evidence");

const PUSH_CHANNEL = "mystatus:push";

/** Minimal but structurally complete push payload (mirrors todo 3's shape). */
function fixturePayload(): Record<string, unknown> {
  const now = Date.now();
  return {
    model: {
      summary: {
        accounts: 5,
        green: 3,
        yellow: 1,
        red: 1,
        lowest: { provider: "MiniMax Token Plan", label: "5-hour", remaining: 3 },
        soonest: { provider: "BytePlus Coding Plan", label: "Session", resetMs: 45 * 60 * 1000 },
      },
      providers: [
        {
          name: "Anthropic Account Quota",
          minRemaining: 49,
          windows: [
            { label: "5-hour limit", remaining: 49, resetMs: 70 * 60 * 1000 },
            { label: "7-day limit", remaining: 72, resetMs: 4 * 86_400_000 },
          ],
        },
        {
          name: "Ollama Cloud",
          minRemaining: 99,
          windows: [{ label: "Session", remaining: 99, resetMs: 60 * 60 * 1000 }],
        },
        {
          name: "MiniMax Token Plan",
          minRemaining: 3,
          windows: [{ label: "5-hour", remaining: 3, resetMs: 60 * 60 * 1000 }],
          stale: { ageMs: 5 * 3_600_000 },
        },
      ],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [{ provider: "LongCat API Quota", kind: "unconfigured", detail: "no credentials" }],
      health: { queried: 3, rendered: 3, stale: 1, failed: 0, unconfigured: 1 },
    },
    fetchedAt: now,
    nextFetchAt: now + 60_000,
  };
}

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  // MANDATORY SAFETY GATE: every launch redirects HOME/USERPROFILE to a
  // throwaway dir so nothing can touch the developer's real config.
  const home = mkdtempSync(join(tmpdir(), "mystatus-e2e-"));
  app = await _electron.launch({
    args: [join(desktopRoot, "out", "main", "index.js")],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      // The built main is not packaged, so its dev branch calls loadURL();
      // point it at the built renderer instead of a dev server.
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

test.describe("desktop shell", () => {
  test("boots with title and renders the three sidebar nav items", async () => {
    await expect(page).toHaveTitle("mystatus");
    const nav = page.getByTestId("sidebar-nav");
    await expect(nav.getByTestId("nav-dashboard")).toHaveText("Dashboard");
    await expect(nav.getByTestId("nav-credentials")).toHaveText("Credentials");
    await expect(nav.getByTestId("nav-settings")).toHaveText("Settings");
    await expect(page.getByTestId("pane-dashboard")).toBeVisible();
  });

  test("state routing switches panes without a router dependency", async () => {
    await page.getByTestId("nav-credentials").click();
    await expect(page.getByTestId("pane-credentials")).toBeVisible();
    await expect(page.getByTestId("pane-dashboard")).toHaveCount(0);

    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("pane-settings")).toBeVisible();
    await expect(page.getByTestId("pane-credentials")).toHaveCount(0);

    await page.getByTestId("nav-dashboard").click();
    await expect(page.getByTestId("pane-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-dashboard")).toHaveAttribute("aria-current", "page");
  });

  test("store consumes a pushed view model and renders provider count", async () => {
    await pushToRenderer(fixturePayload());

    await expect(page.getByTestId("provider-count")).toHaveText("3 providers");
    await expect(page.getByTestId("dashboard-overview")).toContainText("5"); // accounts chip
    await expect(page.getByTestId("soonest-countdown")).toBeVisible();
    await expect(page.getByTestId("connection-status")).toContainText("live");

    // Let the staggered entrance animation finish so the evidence shows the
    // fully-revealed chip grid rather than a mid-fade frame.
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(evidenceDir, "task-4-desktop-app.png") });
  });

  test("pushed error result keeps previous data and shows the failure reason", async () => {
    await pushToRenderer({
      model: { error: "all providers timed out" },
      fetchedAt: Date.now(),
      nextFetchAt: Date.now() + 60_000,
    });

    await expect(page.getByTestId("model-error-strip")).toContainText("all providers timed out");
    // Previous view model stays on screen, TUI-style stale fallback.
    await expect(page.getByTestId("provider-count")).toHaveText("3 providers");
  });

  test("malformed push shows a recoverable panel instead of a white screen", async () => {
    await pushToRenderer({}); // missing model/summary entirely

    const panel = page.getByTestId("payload-error");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("model");
    // Shell chrome survives the bad payload.
    await expect(page.getByTestId("sidebar")).toBeVisible();

    await page.waitForTimeout(500);
    await page.screenshot({ path: join(evidenceDir, "task-4-desktop-app-fail.png") });
  });
});
