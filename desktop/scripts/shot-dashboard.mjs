#!/usr/bin/env node
// Headless dashboard shots — Playwright channel: 'chrome' only.
// No Electron, no electron-vite dev, no GUI app launch.
//
// Usage: node scripts/shot-dashboard.mjs
// Writes PNGs + text dumps under desktop/.shots/

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const rendererRoot = join(desktopDir, "src", "renderer");
const outDir = join(desktopDir, ".shots");

mkdirSync(outDir, { recursive: true });

const vite = await createViteServer({
  root: rendererRoot,
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  plugins: [react(), tailwindcss()],
  logLevel: "error",
});

const server = createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    const pathOnly = url.split("?")[0] ?? "/";
    if (pathOnly === "/" || pathOnly === "/shot.html" || pathOnly === "/index.html") {
      const html = await vite.transformIndexHtml(
        "/shot.html",
        `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>shot</title></head><body><div id="root"></div><script type="module" src="/shot-main.tsx"></script></body></html>`,
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end("not found");
    });
  } catch (err) {
    vite.ssrFixStacktrace?.(err);
    res.statusCode = 500;
    res.end(String(err?.stack ?? err));
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="provider-card"]', { timeout: 30_000 });

async function dump(name) {
  const png = join(outDir, `${name}.png`);
  const txt = join(outDir, `${name}.txt`);
  await page.screenshot({ path: png, fullPage: true });
  const text = await page.locator("body").innerText();
  writeFileSync(txt, text, "utf8");
  console.log(`wrote ${png}`);
  console.log(`--- ${name} text ---`);
  console.log(text);
  console.log(`--- end ${name} ---`);
  return text;
}

await page.getByTestId("tab-all").click();
await page.waitForSelector('[data-testid="provider-card"]');
const allText = await dump("all");

await page.getByTestId("tab-current").click();
await page.waitForSelector('[data-testid="provider-card"]');
const currentText = await dump("current");

await page.getByTestId("tab-weekly").click();
await page.waitForSelector('[data-testid="provider-card"]');
const weeklyText = await dump("weekly");

const checks = [];
function assert(cond, msg) {
  if (!cond) checks.push(`FAIL: ${msg}`);
  else checks.push(`ok: ${msg}`);
}

assert(allText.includes("All"), "All tab present");
assert(allText.includes("Kimi"), "All shows Kimi");
assert(/Kimi[\s\S]*?5-hour[\s\S]*?Weekly/.test(allText) || /Kimi[\s\S]*?Weekly[\s\S]*?5-hour/.test(allText), "All shows Kimi 5-hour + Weekly under one card");
assert(/Anthropic[\s\S]*?5-hour[\s\S]*?7-day[\s\S]*?Monthly/.test(allText) || /Anthropic[\s\S]*?Monthly/.test(allText), "All shows Anthropic multi-window card");
assert(!allText.includes("other tab"), "All tab has no off-tab cue");

assert(currentText.includes("Kimi"), "Current shows Kimi");
assert(currentText.includes("100%"), "Current shows 100% on short window");
assert(currentText.includes("other tab"), "Current explains off-tab worst");
assert(currentText.includes("0%"), "Current cue shows 0%");
assert(!/\bDetails\b/.test(currentText), "no dead Details control");
assert(!/\bWatch\b/.test(currentText), "no dead Watch control");
assert(currentText.includes("Hide"), "Hide control present");
assert(currentText.includes("stale"), "stale badge readable on Poe");
assert(!currentText.includes("Refresh All"), "no duplicate Refresh All");

assert(weeklyText.includes("Kimi"), "Weekly shows Kimi");
assert(/Kimi[\s\S]*?0%/.test(weeklyText), "Weekly shows Kimi at 0%");

const failed = checks.filter((c) => c.startsWith("FAIL"));
for (const c of checks) console.log(c);

await browser.close();
await vite.close();
server.close();

if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed`);
  process.exit(1);
}
console.log("\nshot-dashboard: all checks passed");
