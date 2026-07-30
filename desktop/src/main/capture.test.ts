// Tests for the capture-window service (todo 10).
//
// Two layers:
//   1. captureSession(spec, deps) — unit tests with fully injected deps. No
//      real Electron, no vi.mock needed; the fake session/window are hand-rolled.
//   2. handleCapture (IPC queue) — vi.mock('electron') so the production
//      realDeps path is exercised against fakes; asserts ONE-at-a-time.
//
// No real BrowserWindow is ever created. No GUI. Headless only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureSpec, CaptureResult, CapturedCookie } from "../shared/ipc.js";
import {
  captureSession,
  fallbackResult,
  type CaptureDeps,
  type CaptureWindowOpts,
} from "./capture.js";

// ---------------------------------------------------------------------------
// Fake Electron session + window + webContents
// ---------------------------------------------------------------------------

interface NavEvent {
  url: string;
  preventDefault: () => void;
  defaultPrevented: boolean;
}

type NavListener = (details: NavEvent) => void;
type DidNavListener = (event: unknown, url: string) => void;
type DidRedirectListener = (details: { url: string }) => void;
type OpenHandler = (details: { url: string }) => { action: "allow" | "deny"; overrideBrowserWindowOptions?: unknown };
type ClosedListener = () => void;

interface FakeCookies {
  get: (filter: { url: string }) => Promise<ElectronCookie[]>;
  setCookies: (cookies: ElectronCookie[]) => void;
}

type ElectronCookie = {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  expirationDate?: number;
};

interface FakeSession {
  setUserAgent: (ua: string) => void;
  userAgent: string;
  setPermissionRequestHandler: (h: unknown) => void;
  permissionHandler: unknown;
  clearStorageData: ReturnType<typeof vi.fn>;
  clearCache: ReturnType<typeof vi.fn>;
  clearAuthCache: ReturnType<typeof vi.fn>;
  cookies: FakeCookies;
}

interface FakeWindow {
  webContents: {
    on: (event: string, fn: NavListener | DidNavListener | DidRedirectListener) => void;
    setWindowOpenHandler: (h: OpenHandler) => void;
    listeners: Record<string, Array<NavListener | DidNavListener | DidRedirectListener>>;
    openHandler: OpenHandler | null;
  };
  on: (event: string, fn: ClosedListener) => void;
  isDestroyed: () => boolean;
  close: ReturnType<typeof vi.fn>;
  closedListeners: ClosedListener[];
  destroyed: boolean;
}

function makeFakeSession(cookieJar: ElectronCookie[]): FakeSession {
  return {
    setUserAgent(ua: string) {
      this.userAgent = ua;
    },
    userAgent: "",
    setPermissionRequestHandler(h: unknown) {
      this.permissionHandler = h;
    },
    permissionHandler: null,
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearAuthCache: vi.fn().mockResolvedValue(undefined),
    cookies: {
      get: vi.fn().mockImplementation(async (_filter: { url: string }) => [...cookieJar]),
      setCookies: (c: ElectronCookie[]) => {
        cookieJar.length = 0;
        cookieJar.push(...c);
      },
    },
  };
}

function makeFakeWindow(): FakeWindow {
  const listeners: Record<string, Array<NavListener | DidNavListener | DidRedirectListener>> = {};
  const closedListeners: ClosedListener[] = [];
  const self: FakeWindow = {
    webContents: {
      on(event: string, fn: NavListener | DidNavListener | DidRedirectListener) {
        (listeners[event] ??= []).push(fn);
      },
      setWindowOpenHandler(h: OpenHandler) {
        (self.webContents as unknown as { openHandler: OpenHandler | null }).openHandler = h;
      },
      listeners,
      openHandler: null,
    },
    on(event: string, fn: ClosedListener) {
      if (event === "closed") closedListeners.push(fn);
    },
    isDestroyed: () => self.destroyed,
    close: vi.fn(() => {
      self.destroyed = true;
    }),
    closedListeners,
    destroyed: false,
  };
  return self;
}

function makeDeps(
  ses: FakeSession,
  win: FakeWindow,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval },
): CaptureDeps {
  return {
    fromPartition: () => ses as unknown as import("electron").Session,
    createWindow: (_opts: CaptureWindowOpts) => win as unknown as import("electron").BrowserWindow,
    openExternal: vi.fn().mockResolvedValue(undefined),
    now: () => Date.now(),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  };
}

function makeSpec(overrides: Partial<CaptureSpec> = {}): CaptureSpec {
  return {
    partitionId: "capture-test",
    startUrl: "https://console.example.com",
    allowedOrigins: ["https://console.example.com"],
    idpOrigins: ["https://accounts.google.com", "https://github.com"],
    sentinelCookies: ["session"],
    timeoutMs: 5000,
    ...overrides,
  };
}

// Helper: emit a navigation event on the fake window's webContents.
function emitNav(win: FakeWindow, event: string, url: string): NavEvent | null {
  const ls = win.webContents.listeners[event];
  if (ls === undefined || ls.length === 0) return null;
  const details: NavEvent = {
    url,
    preventDefault: () => {
      details.defaultPrevented = true;
    },
    defaultPrevented: false,
  };
  for (const fn of ls) {
    (fn as NavListener)(details);
  }
  return details;
}

function emitDidNav(win: FakeWindow, url: string): void {
  const ls = win.webContents.listeners["did-navigate"];
  if (ls !== undefined) {
    for (const fn of ls) {
      (fn as DidNavListener)(undefined, url);
    }
  }
}

function emitDidRedirect(win: FakeWindow, url: string): void {
  const ls = win.webContents.listeners["did-redirect-navigation"];
  if (ls !== undefined) {
    for (const fn of ls) {
      (fn as DidRedirectListener)({ url });
    }
  }
}

function emitClosed(win: FakeWindow): void {
  for (const fn of win.closedListeners) fn();
}

// ---------------------------------------------------------------------------
// captureSession unit tests
// ---------------------------------------------------------------------------

describe("captureSession", () => {
  let realTimers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval };
  beforeEach(() => {
    realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prevents navigation outside the allowlist via preventDefault", async () => {
    const cookieJar: ElectronCookie[] = [];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    const spec = makeSpec();
    const promise = captureSession(spec, deps);

    // Disallowed origin navigation.
    const details = emitNav(win, "will-navigate", "https://evil.example.com/path");
    expect(details?.defaultPrevented).toBe(true);

    // Allowed origin navigation — should NOT be prevented.
    const okDetails = emitNav(win, "will-navigate", "https://console.example.com/dashboard");
    expect(okDetails?.defaultPrevented).toBe(false);

    // Same for will-frame-navigate.
    const frameDetails = emitNav(win, "will-frame-navigate", "https://evil.example.com");
    expect(frameDetails?.defaultPrevented).toBe(true);

    // Allow IdP origin (SSO).
    const idpDetails = emitNav(win, "will-frame-navigate", "https://accounts.google.com/signin");
    expect(idpDetails?.defaultPrevented).toBe(false);

    // Resolve the capture so the promise settles (sentinel present).
    cookieJar.push({ name: "session", value: "abc", domain: "console.example.com" });
    await promise;
  });

  it("resolves with cookies when a sentinel cookie appears", async () => {
    const cookieJar: ElectronCookie[] = [
      { name: "other", value: "x", domain: "console.example.com" },
      { name: "session", value: "secret-value", domain: "console.example.com", httpOnly: true },
    ];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    const result = await captureSession(makeSpec(), deps);

    expect(result.status).toBe("ok");
    expect(result.cookies).toHaveLength(2);
    const sentinel = result.cookies.find((c) => c.name === "session");
    expect(sentinel?.value).toBe("secret-value");
    expect(sentinel?.httpOnly).toBe(true);
  });

  it("always calls clearStorageData, clearCache, clearAuthCache exactly once on success", async () => {
    const cookieJar: ElectronCookie[] = [{ name: "session", value: "v" }];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    await captureSession(makeSpec(), deps);

    expect(ses.clearStorageData).toHaveBeenCalledTimes(1);
    expect(ses.clearCache).toHaveBeenCalledTimes(1);
    expect(ses.clearAuthCache).toHaveBeenCalledTimes(1);
  });

  it("closes the window on settle", async () => {
    const cookieJar: ElectronCookie[] = [{ name: "session", value: "v" }];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    await captureSession(makeSpec(), deps);

    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it("sets a Chrome UA with no Electron token on the session", async () => {
    const cookieJar: ElectronCookie[] = [{ name: "session", value: "v" }];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    await captureSession(makeSpec(), deps);

    expect(ses.userAgent).toContain("Chrome/");
    expect(ses.userAgent).not.toContain("Electron");
  });

  it("installs a permission handler that denies all", async () => {
    const cookieJar: ElectronCookie[] = [{ name: "session", value: "v" }];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    await captureSession(makeSpec(), deps);

    expect(ses.permissionHandler).not.toBeNull();
    const handler = ses.permissionHandler as (wc: unknown, perm: unknown, cb: (granted: boolean) => void) => void;
    let granted = true;
    handler(undefined, undefined, (g) => {
      granted = g;
    });
    expect(granted).toBe(false);
  });

  it("asserts sandbox defaults in webPreferences", async () => {
    const cookieJar: ElectronCookie[] = [{ name: "session", value: "v" }];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    let capturedOpts: CaptureWindowOpts | null = null;
    const deps: CaptureDeps = {
      ...makeDeps(ses, win, realTimers),
      createWindow: (opts: CaptureWindowOpts) => {
        capturedOpts = opts;
        return win as unknown as import("electron").BrowserWindow;
      },
    };

    await captureSession(makeSpec(), deps);

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts?.webPreferences.sandbox).toBe(true);
    expect(capturedOpts?.webPreferences.contextIsolation).toBe(true);
    expect(capturedOpts?.webPreferences.nodeIntegration).toBe(false);
    expect(capturedOpts?.webPreferences.partition).toBe("capture-test");
    // NO preload key — the capture window must not attach the app's IPC.
    expect("preload" in (capturedOpts?.webPreferences ?? {})).toBe(false);
  });

  it("setWindowOpenHandler allows allowed origins with the same partition", async () => {
    const cookieJar: ElectronCookie[] = [{ name: "session", value: "v" }];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    const promise = captureSession(makeSpec(), deps);
    // Let the immediate poll run (it finds the sentinel and resolves).
    await promise;

    const handler = win.webContents.openHandler;
    expect(handler).not.toBeNull();
    const allowed = handler!({ url: "https://accounts.google.com/oauth" });
    expect(allowed.action).toBe("allow");
    expect(allowed.overrideBrowserWindowOptions).toMatchObject({
      webPreferences: { partition: "capture-test", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });

    const denied = handler!({ url: "https://evil.example.com" });
    expect(denied.action).toBe("deny");
  });

  it("resolves with timeout when no sentinel appears within timeoutMs and still wipes", async () => {
    vi.useFakeTimers();
    const cookieJar: ElectronCookie[] = [];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps: CaptureDeps = {
      fromPartition: () => ses as unknown as import("electron").Session,
      createWindow: () => win as unknown as import("electron").BrowserWindow,
      openExternal: vi.fn().mockResolvedValue(undefined),
      now: () => 0,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    };

    const spec = makeSpec({ timeoutMs: 1000 });
    const promise = captureSession(spec, deps);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.status).toBe("timeout");
    expect(result.cookies).toEqual([]);
    expect(result.detail).toContain("1000ms");
    expect(ses.clearStorageData).toHaveBeenCalledTimes(1);
    expect(ses.clearCache).toHaveBeenCalledTimes(1);
    expect(ses.clearAuthCache).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("resolves with cancelled when the user closes the window and still wipes", async () => {
    const cookieJar: ElectronCookie[] = [];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    const promise = captureSession(makeSpec({ timeoutMs: 10000 }), deps);

    emitClosed(win);
    const result = await promise;

    expect(result.status).toBe("cancelled");
    expect(result.detail).toContain("closed by user");
    expect(ses.clearStorageData).toHaveBeenCalledTimes(1);
    expect(ses.clearCache).toHaveBeenCalledTimes(1);
    expect(ses.clearAuthCache).toHaveBeenCalledTimes(1);
  });

  it("urlPattern completion fires on did-navigate match", async () => {
    const cookieJar: ElectronCookie[] = [];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    const spec = makeSpec({
      sentinelCookies: [],
      urlPattern: /\/workspace\/[0-9a-f-]+/,
      timeoutMs: 10000,
    });
    const promise = captureSession(spec, deps);

    // Navigate to a workspace URL — should trigger urlPattern completion.
    emitDidNav(win, "https://opencode.ai/workspace/01912345-aaaa-bbbb-cccc-dddddddddddd");

    const result = await promise;
    expect(result.status).toBe("ok");
    expect(result.finalUrl).toBe("https://opencode.ai/workspace/01912345-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("urlPattern completion fires on did-redirect-navigation match", async () => {
    const cookieJar: ElectronCookie[] = [];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const deps = makeDeps(ses, win, realTimers);

    const spec = makeSpec({
      sentinelCookies: [],
      urlPattern: /\/workspace\/[0-9a-f-]+/,
      timeoutMs: 10000,
    });
    const promise = captureSession(spec, deps);

    emitDidRedirect(win, "https://opencode.ai/workspace/abc-123");
    const result = await promise;

    expect(result.status).toBe("ok");
    expect(result.finalUrl).toBe("https://opencode.ai/workspace/abc-123");
  });

  it("does not log cookie names or values", async () => {
    const cookieJar: ElectronCookie[] = [
      { name: "session", value: "super-secret-token" },
      { name: "csrf", value: "csrf-val" },
    ];
    const ses = makeFakeSession(cookieJar);
    const win = makeFakeWindow();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeDeps(ses, win, realTimers);

    await captureSession(makeSpec(), deps);

    const allLogs = consoleSpy.mock.calls.map((c) => String(c)).join(" ");
    expect(allLogs).not.toContain("super-secret-token");
    expect(allLogs).not.toContain("csrf-val");
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// fallbackResult
// ---------------------------------------------------------------------------

describe("fallbackResult", () => {
  it("returns a fallback result with the portal URL for openExternal", () => {
    const result = fallbackResult("https://console.example.com");
    expect(result.status).toBe("fallback");
    expect(result.cookies).toEqual([]);
    expect(result.fallbackUrl).toBe("https://console.example.com");
  });

  it("accepts a custom detail", () => {
    const result = fallbackResult("https://x.example.com", "portal blocked embedded");
    expect(result.detail).toBe("portal blocked embedded");
  });
});

// ---------------------------------------------------------------------------
// handleCapture IPC queue — vi.mock('electron'), ONE at a time
// ---------------------------------------------------------------------------

vi.mock("electron", () => {
  // Minimal fakes: session.fromPartition returns a fake session; BrowserWindow
  // constructor returns a fake window. shell.openExternal is a noop.
  const cookieJars = new Map<string, ElectronCookie[]>();
  const windows: Array<{
    webContents: {
      on: (e: string, fn: unknown) => void;
      setWindowOpenHandler: (h: unknown) => void;
    };
    on: (e: string, fn: () => void) => void;
    isDestroyed: () => boolean;
    close: () => void;
  }> = [];

  function makeSession(partition: string) {
    const jar = cookieJars.get(partition) ?? [];
    cookieJars.set(partition, jar);
    return {
      setUserAgent: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAuthCache: vi.fn().mockResolvedValue(undefined),
      cookies: {
        get: vi.fn().mockImplementation(async () => [...jar]),
      },
      _jar: jar,
    };
  }

  class FakeBrowserWindow {
    webContents: {
      on: (e: string, fn: unknown) => void;
      setWindowOpenHandler: (h: unknown) => void;
    };
    on: (e: string, fn: () => void) => void;
    isDestroyed: () => boolean;
    close: () => void;
    destroyed: boolean;
    closedListeners: Array<() => void>;
    constructor() {
      this.destroyed = false;
      this.closedListeners = [];
      this.webContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      };
      this.on = vi.fn((event: string, fn: () => void) => {
        if (event === "closed") this.closedListeners.push(fn);
      });
      this.isDestroyed = () => this.destroyed;
      this.close = () => {
        this.destroyed = true;
        for (const fn of this.closedListeners) fn();
      };
      windows.push(this as unknown as (typeof windows)[number]);
    }
  }

  return {
    session: { fromPartition: (p: string) => makeSession(p) },
    BrowserWindow: FakeBrowserWindow,
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    // Exposed for tests to seed cookies / trigger window close.
    __cookieJars: cookieJars,
    __windows: windows,
  };
});

describe("handleCapture IPC queue (one at a time)", () => {
  beforeEach(async () => {
    const { resetCaptureQueueForTest } = await import("./capture.js");
    resetCaptureQueueForTest();
    const electron = await import("electron");
    const e = electron as unknown as {
      __cookieJars: Map<string, ElectronCookie[]>;
      __windows: Array<{ close: () => void }>;
    };
    e.__cookieJars.clear();
    e.__windows.length = 0;
  });

  it("runs a single capture to completion via the production handleCapture path", async () => {
    const { handleCapture } = await import("./capture.js");
    const electron = await import("electron");
    const e = electron as unknown as {
      __cookieJars: Map<string, ElectronCookie[]>;
      __windows: Array<{ close: () => void }>;
    };

    // Seed the sentinel cookie so the immediate poll resolves.
    e.__cookieJars.set("q1", [{ name: "session", value: "v" }]);

    const result = await handleCapture({
      partitionId: "q1",
      startUrl: "https://console.example.com",
      allowedOrigins: ["https://console.example.com"],
      idpOrigins: [],
      sentinelCookies: ["session"],
      timeoutMs: 5000,
    });

    expect(result.status).toBe("ok");
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]?.name).toBe("session");
  });

  it("queues a second concurrent capture so only one runs at a time", async () => {
    const { handleCapture } = await import("./capture.js");
    const electron = await import("electron");
    const e = electron as unknown as {
      __cookieJars: Map<string, ElectronCookie[]>;
      __windows: Array<{
        close: () => void;
        closedListeners: Array<() => void>;
        webContents: { on: (ev: string, fn: unknown) => void };
      }>;
    };

    // First capture: no sentinel, no timeout yet — it stays in flight.
    e.__cookieJars.set("q2a", []);
    const first = handleCapture({
      partitionId: "q2a",
      startUrl: "https://a.example.com",
      allowedOrigins: ["https://a.example.com"],
      idpOrigins: [],
      sentinelCookies: ["session"],
      timeoutMs: 100000,
    });

    // Let microtasks settle so the first capture's immediate poll runs.
    await new Promise((r) => setTimeout(r, 0));

    // The first capture is in flight (no sentinel, long timeout). Now start a
    // second — it must queue, not run in parallel.
    e.__cookieJars.set("q2b", [{ name: "session", value: "second" }]);
    const second = handleCapture({
      partitionId: "q2b",
      startUrl: "https://b.example.com",
      allowedOrigins: ["https://b.example.com"],
      idpOrigins: [],
      sentinelCookies: ["session"],
      timeoutMs: 5000,
    });

    // Give the second a chance to (incorrectly) start. With proper queueing
    // it should NOT have resolved yet because the first is still in flight.
    await new Promise((r) => setTimeout(r, 50));
    let secondResolved = false;
    void second.then(() => {
      secondResolved = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(secondResolved).toBe(false);

    // Now close the first capture's window manually → it settles as cancelled,
    // which drains the queue and lets the second run.
    const firstWin = e.__windows[0];
    expect(firstWin).toBeDefined();
    firstWin!.close();

    const firstResult = await first;
    expect(firstResult.status).toBe("cancelled");

    const secondResult = await second;
    expect(secondResult.status).toBe("ok");
    expect(secondResult.cookies[0]?.value).toBe("second");

    // Exactly two windows were created (one per capture), never overlapping.
    expect(e.__windows).toHaveLength(2);
  });
});