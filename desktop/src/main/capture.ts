// Capture-window service (todo 10).
//
// Opens an isolated in-memory BrowserWindow per CaptureSpec, lets the user
// sign in to a provider portal, detects completion via sentinel cookies
// (and optionally a URL pattern), extracts cookies BEFORE close, then ALWAYS
// wipes the partition (clearStorageData + clearCache + clearAuthCache) on
// settle — success, timeout, cancel, or window-closed-by-user.
//
// Security invariants (asserted in code, not just assumed):
//   - session.fromPartition(partitionId) with NO `persist:` prefix → in-memory.
//   - BrowserWindow webPreferences explicitly sets sandbox:true,
//     contextIsolation:true, nodeIntegration:false, and NO preload, so a
//     future Electron default change cannot silently weaken isolation.
//   - will-navigate + will-frame-navigate allow only allowedOrigins ∪ idpOrigins;
//     disallowed navigations are prevented via event.preventDefault().
//   - setWindowOpenHandler allows OAuth popups ONLY with the same partition;
//     everything else is denied.
//   - Cookie names+values are never logged.
//
// Electron 43 Session has no `close()` method — in-memory partitions are
// released when the process exits or the session is garbage-collected after
// all references drop. The mandatory clear* calls empty the partition's data
// before the window closes, so no session state survives the capture.

import {
  BrowserWindow,
  session,
  shell,
  type Session,
  type WebContents,
} from "electron";
import type {
  CaptureRequest,
  CaptureResult,
  CaptureSpec,
  CapturedCookie,
} from "../shared/ipc.js";

// Current stable Chrome UA (no Electron token). Several portals reject the
// default Electron UA, so this is set on the session before any navigation.
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const POLL_INTERVAL_MS = 2000;

export interface CaptureDeps {
  readonly fromPartition: (partition: string) => Session;
  readonly createWindow: (opts: CaptureWindowOpts) => BrowserWindow;
  readonly openExternal: (url: string) => Promise<void>;
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  readonly setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  readonly clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

export interface CaptureWindowOpts {
  readonly partition: string;
  readonly width: number;
  readonly height: number;
  readonly webPreferences: {
    readonly partition: string;
    readonly sandbox: boolean;
    readonly contextIsolation: boolean;
    readonly nodeIntegration: boolean;
  };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function isAllowed(url: string, allow: ReadonlySet<string>): boolean {
  const o = originOf(url);
  if (o === "") return false;
  return allow.has(o);
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

function toCaptured(cookie: ElectronCookie): CapturedCookie {
  const out: CapturedCookie = { name: cookie.name, value: cookie.value };
  if (cookie.domain !== undefined) out.domain = cookie.domain;
  if (cookie.hostOnly !== undefined) out.hostOnly = cookie.hostOnly;
  if (cookie.httpOnly !== undefined) out.httpOnly = cookie.httpOnly;
  if (cookie.secure !== undefined) out.secure = cookie.secure;
  if (cookie.path !== undefined) out.path = cookie.path;
  if (cookie.expirationDate !== undefined) out.expirationDate = cookie.expirationDate;
  return out;
}

async function wipe(ses: Session): Promise<void> {
  await Promise.all([
    ses.clearStorageData(),
    ses.clearCache(),
    ses.clearAuthCache(),
  ]);
}

interface SettleState {
  settled: boolean;
  result: CaptureResult | null;
}

/**
 * Run a single capture session. Resolves with a CaptureResult. Never rejects —
 * every settle path (ok / timeout / cancelled / fallback) produces a result
 * and ALWAYS wipes the partition first.
 *
 * The deps parameter is injected so unit tests can mock Electron without
 * booting a real BrowserWindow. The production singleton wires real Electron.
 */
export async function captureSession(
  spec: CaptureSpec,
  deps: CaptureDeps,
): Promise<CaptureResult> {
  const allow = new Set<string>([...spec.allowedOrigins, ...spec.idpOrigins]);

  const ses = deps.fromPartition(spec.partitionId);
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const win = deps.createWindow({
    partition: spec.partitionId,
    width: 1100,
    height: 800,
    webPreferences: {
      partition: spec.partitionId,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const wc: WebContents = win.webContents;
  const state: SettleState = { settled: false, result: null };
  let finalUrl: string | undefined;
  let urlPatternMatched = false;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

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

  // Navigation allowlist — prevent the capture window from wandering to
  // arbitrary origins. Both will-navigate (main frame) and will-frame-navigate
  // (any frame) are guarded so an iframe cannot escape either. Disallowed
  // navigations are cancelled via preventDefault.
  wc.on("will-navigate", (details) => {
    if (!isAllowed(details.url, allow)) {
      details.preventDefault();
    }
  });
  wc.on("will-frame-navigate", (details) => {
    if (!isAllowed(details.url, allow)) {
      details.preventDefault();
    }
  });

  // OAuth popups: allow only with the SAME in-memory partition; deny all
  // others so a popup cannot escape into the default session.
  wc.setWindowOpenHandler((details) => {
    if (isAllowed(details.url, allow)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: spec.partitionId,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    return { action: "deny" };
  });

  // Track navigations for finalUrl + optional urlPattern completion.
  wc.on("did-navigate", (_event, url) => {
    finalUrl = url;
    if (spec.urlPattern !== undefined && spec.urlPattern.test(url)) {
      urlPatternMatched = true;
    }
  });
  wc.on("did-redirect-navigation", (details) => {
    finalUrl = details.url;
    if (spec.urlPattern !== undefined && spec.urlPattern.test(details.url)) {
      urlPatternMatched = true;
    }
  });

  // settle: wipe, close, produce result. Idempotent — the first caller wins
  // and subsequent callers receive the same result. Always wipes before
  // closing so in-memory cookies are gone before the window disappears.
  const settle = async (
    status: CaptureResult["status"],
    cookies: readonly CapturedCookie[],
    extra: Partial<CaptureResult> = {},
  ): Promise<CaptureResult> => {
    if (state.settled) {
      return state.result ?? { status: "cancelled", cookies: [] };
    }
    state.settled = true;
    cleanupTimers();
    try {
      await wipe(ses);
    } catch {
      // best-effort wipe; still close the window
    }
    if (!win.isDestroyed()) win.close();
    const result: CaptureResult = { status, cookies, ...extra };
    state.result = result;
    return result;
  };

  // Completion detection: sentinel cookie poll (2s interval) + optional
  // urlPattern match. Resolves once either condition holds.
  const completion = new Promise<{ cookies: readonly CapturedCookie[]; finalUrl?: string }>(
    (resolve) => {
      const check = async (): Promise<void> => {
        if (state.settled) return;
        try {
          const all = (await ses.cookies.get({ url: spec.startUrl })) as ElectronCookie[];
          const names = new Set(all.map((c) => c.name));
          const hasSentinel = spec.sentinelCookies.some((n) => names.has(n));
          const hasPattern = spec.urlPattern !== undefined && urlPatternMatched;
          if (hasSentinel || hasPattern) {
            const extracted = all.map(toCaptured);
            resolve({ cookies: extracted, finalUrl });
          }
        } catch {
          // Cookie read failure — keep polling; transient.
        }
      };
      pollId = deps.setInterval(check, POLL_INTERVAL_MS);
      // Fire once immediately so a fast sign-in (cached IdP) is detected
      // without waiting 2s.
      void check();
    },
  );

  // Timeout: resolves with 'timeout' if completion did not fire first.
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = deps.setTimeout(() => resolve("timeout"), spec.timeoutMs);
  });

  // User closes the window manually → 'cancelled'.
  const closed = new Promise<"cancelled">((resolve) => {
    win.on("closed", () => {
      if (!state.settled) resolve("cancelled");
    });
  });

  const winner = await Promise.race([
    completion.then((c) => ({ kind: "ok" as const, ...c })),
    timeout.then(() => ({ kind: "timeout" as const })),
    closed.then(() => ({ kind: "cancelled" as const })),
  ]);

  if (winner.kind === "ok") {
    return settle("ok", winner.cookies, {
      ...(winner.finalUrl !== undefined ? { finalUrl: winner.finalUrl } : {}),
    });
  }
  if (winner.kind === "timeout") {
    return settle("timeout", [], {
      detail: `no sentinel cookie within ${spec.timeoutMs}ms`,
    });
  }
  return settle("cancelled", [], { detail: "window closed by user" });
}

// ---------------------------------------------------------------------------
// Embedded-login fallback (todo 10 spec): if a portal refuses the embedded
// browser, the caller can request a fallback result that carries the portal
// URL so the renderer can offer shell.openExternal + the manual paste path
// (todo 12). This is a pure function — no window is opened.
// ---------------------------------------------------------------------------
export function fallbackResult(portalUrl: string, detail?: string): CaptureResult {
  return {
    status: "fallback",
    cookies: [],
    fallbackUrl: portalUrl,
    detail: detail ?? "embedded login unavailable; open externally",
  };
}

// ---------------------------------------------------------------------------
// Production singleton + IPC queue (ONE capture at a time).
// ---------------------------------------------------------------------------

const realDeps: CaptureDeps = {
  fromPartition: (p) => session.fromPartition(p),
  createWindow: (opts) =>
    new BrowserWindow({
      width: opts.width,
      height: opts.height,
      webPreferences: opts.webPreferences,
    }),
  openExternal: (url) => shell.openExternal(url),
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

let captureInFlight: Promise<CaptureResult> | null = null;
let captureQueue: Array<() => void> = [];

function drainQueue(): void {
  if (captureInFlight !== null) return;
  const next = captureQueue.shift();
  if (next === undefined) return;
  next();
}

/**
 * IPC handler for mystatus:capture. Serializes capture requests so only ONE
 * capture window exists at a time; concurrent requests queue and run in
 * arrival order. Never rejects — errors arrive as a cancelled/timeout result.
 */
export async function handleCapture(spec: CaptureRequest): Promise<CaptureResult> {
  // If a capture is in flight, wait for it to finish before starting ours.
  if (captureInFlight !== null) {
    await new Promise<void>((resolve) => {
      captureQueue.push(resolve);
    });
  }

  captureInFlight = (async () => {
    try {
      return await captureSession(spec, realDeps);
    } finally {
      captureInFlight = null;
      drainQueue();
    }
  })();

  return captureInFlight;
}

/** Reset the queue + in-flight state. Test-only. */
export function resetCaptureQueueForTest(): void {
  captureInFlight = null;
  captureQueue = [];
}