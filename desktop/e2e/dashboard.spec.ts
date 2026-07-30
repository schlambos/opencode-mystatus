import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const evidenceDir = resolve(desktopRoot, "..", ".omo", "evidence");

const PUSH_CHANNEL = "mystatus:push";
const H = 3_600_000;
const D = 24 * H;

/**
 * Three providers chosen to exercise every horizon rule:
 *  - Anthropic: multi-tier (short + weekly + monthly)
 *  - xAI/Grok:  weekly-only  (stays on Current via fallback, absent from Monthly)
 *  - Poe:       monthly-only "Plan points" (stays on Current, EXCLUDED from Monthly)
 */
function fixturePayload(): Record<string, unknown> {
  const now = Date.now();
  return {
    model: {
      summary: {
        accounts: 3,
        green: 2,
        yellow: 1,
        red: 0,
        lowest: { provider: "xAI/Grok", label: "Weekly SuperGrok limit", remaining: 22 },
        soonest: { provider: "Anthropic Account Quota", label: "5-hour limit", resetMs: 70 * 60_000 },
      },
      providers: [
        {
          name: "Anthropic Account Quota",
          minRemaining: 49,
          windows: [
            { label: "5-hour limit", remaining: 49, resetMs: 70 * 60_000 },
            { label: "7-day limit", remaining: 72, resetMs: 4 * D },
            { label: "Monthly plan total", remaining: 84, resetMs: 29 * D },
          ],
        },
        {
          name: "xAI/Grok",
          minRemaining: 22,
          windows: [{ label: "Weekly SuperGrok limit", remaining: 22, resetMs: 6 * D }],
        },
        {
          name: "Poe",
          minRemaining: 46,
          windows: [{ label: "Plan points", remaining: 46, resetMs: 11 * D }],
          note: "cached (12 min ago)",
          stale: { ageMs: 5 * H, reason: "token expired" },
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
  // MANDATORY SAFETY GATE: HOME/USERPROFILE redirected to a throwaway dir so
  // config/cache reads never touch the developer's real files.
  const home = mkdtempSync(join(tmpdir(), "mystatus-e2e-"));
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

async function providerOrder(): Promise<Array<string | null>> {
  const cards = page.getByTestId("provider-card");
  const all = await cards.all();
  return Promise.all(all.map((c) => c.getAttribute("data-provider-name")));
}

test.describe("dashboard horizon tabs and provider cards", () => {
  // Re-push the fixture before every test so each starts from a known model
  // state. The main-process poller pushes real (error) payloads on its own
  // schedule; without a re-push, later tests can race the poller and see a
  // null model ("awaiting first sync"). Tests that need a different payload
  // push their own after this hook.
  test.beforeEach(async () => {
    await pushToRenderer(fixturePayload());
  });

  test("current tab sorts providers by min remaining asc", async () => {

    const current = page.getByTestId("tab-current");
    await expect(current).toBeVisible();
    await expect(current).toHaveAttribute("aria-pressed", "true");

    // worst-first: Grok 22% → Poe 46% → Anthropic 49%
    await expect(page.getByTestId("quota-grid")).toBeVisible();
    expect(await providerOrder()).toEqual(["xAI/Grok", "Poe", "Anthropic Account Quota"]);

    // Current fallback: weekly-only Grok and monthly-only Poe appear here too.
    const grok = page.getByTestId("provider-card").filter({ hasText: "xAI/Grok" });
    await expect(grok.getByTestId("meter-row").getByTestId("meter-pct")).toHaveText("22%");
    const poe = page.getByTestId("provider-card").filter({ hasText: "Poe" });
    await expect(poe.getByTestId("meter-pct")).toHaveText("46%");

    // Anthropic's Current view shows ONLY its short window.
    const anthropic = page.getByTestId("provider-card").filter({ hasText: "Anthropic" });
    const rows = anthropic.getByTestId("meter-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId("meter-pct")).toHaveText("49%");
    await expect(rows.getByTestId("meter-countdown")).toContainText("↻");

    // stale badge + note render on the Poe card.
    await expect(poe.getByTestId("stale-badge")).toHaveText("stale 5h");
    await expect(poe.getByTestId("provider-note")).toContainText("cached");
  });

  test("weekly tab collects every weekly window, dropping weekly-less providers", async () => {
    await page.getByTestId("tab-weekly").click();

    expect(await providerOrder()).toEqual(["xAI/Grok", "Anthropic Account Quota"]);
    const anthropic = page.getByTestId("provider-card").filter({ hasText: "Anthropic" });
    const rows = anthropic.getByTestId("meter-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId("meter-pct")).toHaveText("72%");

    // Poe has no weekly windows → no card at all.
    await expect(page.getByTestId("provider-card").filter({ hasText: "Poe" })).toHaveCount(0);
  });

  test("monthly tab shows billing windows for multi-tier providers only", async () => {
    await page.getByTestId("tab-monthly").click();

    // Anthropic qualifies (has short+weekly tiers); Grok (weekly-only) and
    // Poe (monthly-only) are EXCLUDED — credits-only providers stay on Current.
    expect(await providerOrder()).toEqual(["Anthropic Account Quota"]);
    const rows = page.getByTestId("provider-card").getByTestId("meter-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.getByTestId("meter-pct")).toHaveText("84%");
  });

  test("issues tab shows the health line and unconfigured list", async () => {
    await expect(page.getByTestId("tab-issues-badge")).toHaveText("1"); // failed + stale
    await page.getByTestId("tab-issues").click();

    const panel = page.getByTestId("issues-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("issues-health")).toHaveText(
      "3 of 3 providers reporting · 1 stale · 1 not configured",
    );
    await expect(panel).toContainText("Every configured provider answered live");
    await expect(page.getByTestId("issues-unconfigured")).toContainText("LongCat API");
  });

  test("hidden tab is absent while nothing is hidden", async () => {
    await expect(page.getByTestId("tab-hidden")).toHaveCount(0);
  });

  test("tabs split one pushed model client-side and survive cycling", async () => {
    // Cycling back to Current must show the same data — no re-query, no loss.
    await page.getByTestId("tab-current").click();
    expect(await providerOrder()).toEqual(["xAI/Grok", "Poe", "Anthropic Account Quota"]);

    await page.waitForTimeout(900); // let staggered entrances finish for evidence
    await page.screenshot({ path: join(evidenceDir, "task-6-desktop-app.png") });
  });

  test("zero-remaining and zero-window providers never crash the tab", async () => {
    const now = Date.now();
    await pushToRenderer({
      model: {
        summary: {
          accounts: 2,
          green: 1,
          yellow: 0,
          red: 1,
          lowest: { provider: "Zero Provider", label: "Session", remaining: 0 },
        },
        providers: [
          {
            name: "Zero Provider",
            minRemaining: 0,
            windows: [{ label: "Session", remaining: 0, resetMs: H }],
          },
          { name: "Empty Provider", minRemaining: 100, windows: [] },
          {
            name: "Ollama Cloud",
            minRemaining: 99,
            windows: [{ label: "Session", remaining: 99, resetMs: H }],
          },
        ],
        errors: [],
        alerts: ["Zero Provider · Session: 0%"],
        threshold: 25,
        issues: [],
        health: { queried: 3, rendered: 2, stale: 0, failed: 0, unconfigured: 0 },
      },
      fetchedAt: now,
      nextFetchAt: now + 60_000,
    });

    await page.getByTestId("tab-current").click();
    expect(await providerOrder()).toEqual(["Zero Provider", "Ollama Cloud"]);

    const zero = page.getByTestId("provider-card").filter({ hasText: "Zero Provider" });
    await expect(zero.getByTestId("meter-pct")).toHaveText("0%");
    await expect(zero.getByTestId("meter-fill")).toHaveAttribute("data-tone", "dead");

    // A provider with no windows is skipped, not crashed over.
    await expect(page.getByTestId("provider-card").filter({ hasText: "Empty Provider" })).toHaveCount(0);

    await page.waitForTimeout(600);
    await page.screenshot({ path: join(evidenceDir, "task-6-desktop-app-fail.png") });
  });
});
