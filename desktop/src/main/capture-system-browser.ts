// In-app sign-in via a real Chromium engine (Chrome/Edge/Brave/Arc).
//
// Google permanently blocks OAuth inside Electron's BrowserWindow / <webview>
// ("This browser or app may not be secure"). There is no Electron spoof that
// fixes this. The workable approach is a throwaway system-Chrome profile
// opened as an **app window** (`--app=URL`) — no tabs, no omnibox — so it
// feels like a login dialog owned by MyStatus, not "go use your browser".
//
// Flow:
//   1. Find Chrome / Edge / Brave / Arc
//   2. Launch --app=<startUrl> with temp --user-data-dir + remote debugging
//      (never --enable-automation / --headless)
//   3. CDP: Storage.getCookies + page-session Network.getCookies
//   4. On sentinel / urlPattern / close / timeout → kill app window, wipe profile
//
// Cookie names+values are never logged.

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { CaptureResult, CaptureSpec, CapturedCookie } from "../shared/ipc.js";

const POLL_INTERVAL_MS = 1000;
const CDP_READY_TIMEOUT_MS = 25_000;
const CDP_READY_POLL_MS = 150;

export interface SystemBrowserDeps {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  readonly setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  readonly clearInterval: (id: ReturnType<typeof setInterval>) => void;
  readonly findBrowser: () => string | null;
  readonly freePort: () => Promise<number>;
  readonly mkdtemp: (prefix: string) => string;
  readonly rmrf: (dir: string) => void;
  readonly spawnBrowser: (exe: string, args: readonly string[]) => ChildProcess;
  readonly connectCdp: (browserWSEndpoint: string) => Promise<CdpConn>;
  readonly waitForCdpEndpoint: (port: number, timeoutMs: number) => Promise<string>;
}

export interface CdpConn {
  readonly send: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ) => Promise<T>;
  readonly onEvent: (handler: (method: string, params: Record<string, unknown>) => void) => void;
  readonly close: () => void;
}

type CdpCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
};

// ---------------------------------------------------------------------------
// Browser discovery
// ---------------------------------------------------------------------------

const DARWIN_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Arc.app/Contents/MacOS/Arc",
] as const;

const LINUX_CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "brave-browser",
] as const;

function windowsCandidates(): string[] {
  const pf = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
  const pf86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? "";
  return [
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    join(local, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
  ];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    try {
      accessSync(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/** Resolve a system Chromium-based browser binary, or null if none found. */
export function findSystemBrowser(
  platform = process.platform,
  pathEnv = process.env["PATH"] ?? "",
): string | null {
  if (platform === "darwin") {
    for (const p of DARWIN_CANDIDATES) {
      if (isExecutable(p)) return p;
    }
    return null;
  }
  if (platform === "win32") {
    for (const p of windowsCandidates()) {
      if (isExecutable(p)) return p;
    }
    return null;
  }
  const dirs = pathEnv.split(":").filter(Boolean);
  for (const name of LINUX_CANDIDATES) {
    for (const dir of dirs) {
      const full = join(dir, name);
      if (isExecutable(full)) return full;
    }
  }
  return null;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// CDP client (supports flattened target sessions via sessionId)
// ---------------------------------------------------------------------------

export async function waitForCdpEndpoint(
  port: number,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "cdp not ready";
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const body = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (typeof body.webSocketDebuggerUrl === "string" && body.webSocketDebuggerUrl.length > 0) {
          return body.webSocketDebuggerUrl;
        }
        lastErr = "missing webSocketDebuggerUrl";
      } else {
        lastErr = `http ${res.status}`;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(CDP_READY_POLL_MS);
  }
  throw new Error(`CDP endpoint not ready on port ${port}: ${lastErr}`);
}

export async function connectCdp(browserWSEndpoint: string): Promise<CdpConn> {
  const ws = new WebSocket(browserWSEndpoint);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("CDP websocket connect timeout")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("CDP websocket error"));
    });
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const eventHandlers: Array<(method: string, params: Record<string, unknown>) => void> = [];

  ws.addEventListener("message", (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
    let msg: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string };
      sessionId?: string;
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      // Flattened session events arrive as method + params (sessionId on envelope).
      for (const h of eventHandlers) h(msg.method, msg.params ?? {});
    }
  });

  const send = <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      const envelope: Record<string, unknown> = { id, method };
      if (params !== undefined) envelope.params = params;
      if (sessionId !== undefined) envelope.sessionId = sessionId;
      try {
        ws.send(JSON.stringify(envelope));
      } catch (e) {
        pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };

  return {
    send,
    onEvent: (handler) => {
      eventHandlers.push(handler);
    },
    close: () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      for (const [, p] of pending) p.reject(new Error("CDP closed"));
      pending.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function toCaptured(c: CdpCookie): CapturedCookie {
  const out: CapturedCookie = { name: c.name, value: c.value };
  if (c.domain !== undefined) out.domain = c.domain;
  if (c.path !== undefined) out.path = c.path;
  if (c.httpOnly !== undefined) out.httpOnly = c.httpOnly;
  if (c.secure !== undefined) out.secure = c.secure;
  if (typeof c.expires === "number" && c.expires > 0) out.expirationDate = c.expires;
  return out;
}

function cookieUrlsFor(spec: CaptureSpec): string[] {
  const urls = new Set<string>([spec.startUrl]);
  for (const o of spec.allowedOrigins) urls.add(o.endsWith("/") ? o : `${o}/`);
  // Always include bare origin roots for cookie jar matching.
  try {
    urls.add(new URL(spec.startUrl).origin + "/");
  } catch {
    // ignore
  }
  return [...urls];
}

async function attachPrimaryPage(cdp: CdpConn): Promise<string | null> {
  try {
    const { targetInfos } = await cdp.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    }>("Target.getTargets");
    const page =
      targetInfos.find((t) => t.type === "page" && t.url.startsWith("http")) ??
      targetInfos.find((t) => t.type === "page");
    if (!page) return null;
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    });
    try {
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Page.bringToFront", {}, sessionId);
    } catch {
      // optional
    }
    return sessionId;
  } catch {
    return null;
  }
}

async function readCookies(
  cdp: CdpConn,
  spec: CaptureSpec,
  pageSessionId: string | null,
): Promise<CapturedCookie[]> {
  // 1) Browser-context dump (works on modern Chrome without Network domain).
  try {
    const all = await cdp.send<{ cookies: CdpCookie[] }>("Storage.getCookies", {});
    if (Array.isArray(all.cookies) && all.cookies.length > 0) {
      return all.cookies.map(toCaptured);
    }
  } catch {
    // fall through
  }

  // 2) Page-session Network.getCookies for portal URLs.
  if (pageSessionId) {
    try {
      const some = await cdp.send<{ cookies: CdpCookie[] }>(
        "Network.getCookies",
        { urls: cookieUrlsFor(spec) },
        pageSessionId,
      );
      if (Array.isArray(some.cookies)) return some.cookies.map(toCaptured);
    } catch {
      // fall through
    }
  }

  // 3) Empty Storage result is still a valid empty jar.
  try {
    const all = await cdp.send<{ cookies: CdpCookie[] }>("Storage.getCookies", {});
    if (Array.isArray(all.cookies)) return all.cookies.map(toCaptured);
  } catch {
    // ignore
  }
  return [];
}

function hasSentinel(cookies: readonly CapturedCookie[], names: readonly string[]): boolean {
  const have = new Set(cookies.map((c) => c.name));
  return names.some((n) => have.has(n));
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

const defaultDeps: SystemBrowserDeps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  findBrowser: () => findSystemBrowser(),
  freePort,
  mkdtemp: (prefix) => mkdtempSync(prefix),
  rmrf: (dir) => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  },
  spawnBrowser: (exe, args) =>
    spawn(exe, [...args], {
      stdio: ["ignore", "ignore", "ignore"],
    }),
  connectCdp,
  waitForCdpEndpoint,
};

/**
 * Open an app-mode Chromium window for sign-in and capture cookies.
 * Returns null only when no system browser is installed.
 * Never rejects.
 */
export async function captureWithSystemBrowser(
  spec: CaptureSpec,
  deps: SystemBrowserDeps = defaultDeps,
): Promise<CaptureResult | null> {
  const exe = deps.findBrowser();
  if (exe === null) return null;

  let userDataDir: string | null = null;
  let child: ChildProcess | null = null;
  let cdp: CdpConn | null = null;
  let pageSessionId: string | null = null;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let finalUrl: string | undefined = spec.startUrl;
  let urlPatternMatched = false;

  const cleanupTimers = (): void => {
    if (pollId !== null) {
      deps.clearInterval(pollId);
      pollId = null;
    }
    if (timeoutId !== null) {
      deps.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const shutdown = (): void => {
    cleanupTimers();
    if (cdp !== null) {
      try {
        cdp.close();
      } catch {
        // ignore
      }
      cdp = null;
    }
    if (child !== null && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      const c = child;
      deps.setTimeout(() => {
        try {
          if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1500);
    }
    child = null;
    if (userDataDir !== null) {
      const dir = userDataDir;
      userDataDir = null;
      deps.setTimeout(() => deps.rmrf(dir), 800);
    }
  };

  try {
    userDataDir = deps.mkdtemp(join(tmpdir(), "mystatus-capture-"));
    const port = await deps.freePort();

    // --app=URL → dedicated login window (no tab strip / omnibox). This is the
    // closest thing to an in-app WebView that Google will still accept.
    const args = [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-features=Translate,MediaRouter",
      "--window-size=1100,800",
      `--app=${spec.startUrl}`,
    ];

    child = deps.spawnBrowser(exe, args);

    const exitPromise = new Promise<"cancelled">((resolve) => {
      child?.once("exit", () => {
        if (!settled) resolve("cancelled");
      });
      child?.once("error", () => {
        if (!settled) resolve("cancelled");
      });
    });

    const wsUrl = await deps.waitForCdpEndpoint(port, CDP_READY_TIMEOUT_MS);
    cdp = await deps.connectCdp(wsUrl);

    await cdp.send("Target.setDiscoverTargets", { discover: true });
    cdp.onEvent((method, params) => {
      if (method === "Target.targetInfoChanged" || method === "Target.targetCreated") {
        const info = params["targetInfo"] as { type?: string; url?: string } | undefined;
        if (info?.type === "page" && typeof info.url === "string" && info.url.startsWith("http")) {
          finalUrl = info.url;
          if (spec.urlPattern !== undefined && spec.urlPattern.test(info.url)) {
            urlPatternMatched = true;
          }
        }
      }
      if (method === "Page.frameNavigated") {
        const frame = params["frame"] as { url?: string; parentId?: string } | undefined;
        if (frame && !frame.parentId && typeof frame.url === "string" && frame.url.startsWith("http")) {
          finalUrl = frame.url;
          if (spec.urlPattern !== undefined && spec.urlPattern.test(frame.url)) {
            urlPatternMatched = true;
          }
        }
      }
    });

    // Attach to the app window page (retry briefly — target can lag spawn).
    for (let i = 0; i < 20 && pageSessionId === null; i++) {
      pageSessionId = await attachPrimaryPage(cdp);
      if (pageSessionId === null) {
        await new Promise<void>((r) => deps.setTimeout(r, 150));
      }
    }

    // If --app didn't load the URL, force a target open.
    if (pageSessionId === null) {
      try {
        await cdp.send("Target.createTarget", { url: spec.startUrl });
        pageSessionId = await attachPrimaryPage(cdp);
      } catch {
        // continue; cookie poll may still work via Storage.getCookies
      }
    }

    const completion = new Promise<{
      cookies: readonly CapturedCookie[];
      finalUrl?: string;
    }>((resolve) => {
      const check = (): void => {
        if (settled || cdp === null) return;
        void (async () => {
          try {
            // Re-attach if the first page was replaced by an OAuth popup/redirect target.
            if (pageSessionId === null) {
              pageSessionId = await attachPrimaryPage(cdp!);
            }
            const cookies = await readCookies(cdp!, spec, pageSessionId);
            const okSentinel =
              spec.sentinelCookies.length > 0 && hasSentinel(cookies, spec.sentinelCookies);
            const okPattern = spec.urlPattern !== undefined && urlPatternMatched;
            if (okSentinel || okPattern) {
              resolve({
                cookies,
                ...(finalUrl !== undefined ? { finalUrl } : {}),
              });
            }
          } catch {
            // transient
          }
        })();
      };
      pollId = deps.setInterval(check, POLL_INTERVAL_MS);
      check();
    });

    const timeout = new Promise<"timeout">((resolve) => {
      timeoutId = deps.setTimeout(() => resolve("timeout"), spec.timeoutMs);
    });

    const winner = await Promise.race([
      completion.then((c) => ({ kind: "ok" as const, ...c })),
      timeout.then(() => ({ kind: "timeout" as const })),
      exitPromise.then(() => ({ kind: "cancelled" as const })),
    ]);

    settled = true;
    cleanupTimers();

    if (winner.kind === "ok") {
      let cookies = winner.cookies;
      try {
        if (cdp) cookies = await readCookies(cdp, spec, pageSessionId);
      } catch {
        // keep prior
      }
      shutdown();
      return {
        status: "ok",
        cookies,
        ...(winner.finalUrl !== undefined ? { finalUrl: winner.finalUrl } : {}),
        detail: "captured via app window",
      };
    }

    shutdown();
    if (winner.kind === "timeout") {
      return {
        status: "timeout",
        cookies: [],
        detail: `no sentinel cookie within ${spec.timeoutMs}ms`,
      };
    }
    return {
      status: "cancelled",
      cookies: [],
      detail: "sign-in window closed",
    };
  } catch (e) {
    settled = true;
    shutdown();
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "cancelled",
      cookies: [],
      detail: `sign-in window failed: ${msg}`,
    };
  }
}
