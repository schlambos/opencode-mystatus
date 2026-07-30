// Main-process polling service (todo 3).
//
// A singleton StatusPoller that periodically calls coreApi.getViewModel and
// pushes the result to every open BrowserWindow via webContents.send on the
// `mystatus:push` channel. The interval is re-derived from mystatus.json on
// every tick (cheap loadConfig) so external edits to watchIntervalSec take
// effect without a restart. cacheTtlSec is honored by the core itself — the
// poller never re-implements caching.
//
// Single-flight is MANDATORY: the core gives each provider a 15s deadline
// (plugin/mystatus.ts:7422) so a slow cycle can exceed a 60s interval, and two
// overlapping queryMyStatus calls both do read-modify-write on
// mystatus-cache.json and mystatus-history.json (plugin/mystatus.ts:6830-6843,
// 6945-6956) and would lose entries. An in-flight guard plus a pending-force
// flag ensure a forceRefresh requested mid-cycle runs immediately after the
// current cycle completes — never concurrently.
//
// Polling runs only while at least one window is open OR the tray is alive
// (setTrayAlive, wired in todo 16). When neither holds, ticks reschedule at
// the configured interval but skip the fetch, so the cycle resumes instantly
// when a window reopens.
//
// Non-poll rebuilds (e.g. re-deriving after a config change) MUST pass
// { recordHistory: false } to the core. The poller only performs real polls
// (which record history by default via coreApi.getViewModel), so this guard
// is satisfied vacuously here; it is documented for the future code paths
// that will re-derive without polling.

import { BrowserWindow } from "electron";
import { CHANNELS, type MyStatusConfig, type PushPayload, type ViewModelResult } from "../shared/ipc.js";
import { coreApi, type CoreApi } from "./core.js";

const MIN_INTERVAL_SEC = 5;
const DEFAULT_INTERVAL_SEC = 60;

export interface PollerDeps {
  readonly coreApi: CoreApi;
  readonly loadConfig: () => MyStatusConfig;
  readonly getAllWindows: () => BrowserWindow[];
  readonly now: () => number;
}

function intervalMs(cfg: MyStatusConfig): number {
  const sec = Math.max(MIN_INTERVAL_SEC, cfg.watchIntervalSec ?? DEFAULT_INTERVAL_SEC);
  return sec * 1000;
}

function configSignature(cfg: MyStatusConfig): string {
  return JSON.stringify(cfg);
}

export class StatusPoller {
  private readonly deps: PollerDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private forcePending = false;
  private forceResolver: (() => void) | null = null;
  private trayAlive = false;
  private lastConfigSig: string | null = null;

  constructor(deps: PollerDeps) {
    this.deps = deps;
  }

  /** Tray liveness gate for todo 16. When true, polling continues with no windows. */
  setTrayAlive(alive: boolean): void {
    this.trayAlive = alive;
  }

  /** Begin polling. The first fetch is scheduled immediately (0ms delay). */
  start(): void {
    if (this.timer !== null) return;
    this.scheduleNext(0);
  }

  /** Stop polling and clear any pending timer. Safe to call when not running. */
  stop(): void {
    this.clearTimer();
  }

  /**
   * Force an out-of-schedule fresh fetch ({ fresh: true }). Bypasses the
   * scheduled tick timing but still respects single-flight: if a fetch is
   * in-flight, the force runs immediately after it completes. The returned
   * promise resolves once the forced fetch has broadcast its payload.
   */
  forceRefresh(): Promise<void> {
    if (this.inFlight) {
      this.forcePending = true;
      return new Promise<void>((resolve) => {
        this.forceResolver = resolve;
      });
    }
    return this.fetch(true);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private shouldPoll(): boolean {
    return this.deps.getAllWindows().length >= 1 || this.trayAlive;
  }

  private async tick(): Promise<void> {
    if (!this.shouldPoll()) {
      // No audience: reschedule at the configured interval so polling
      // resumes instantly when a window or the tray reappears.
      this.scheduleNext(intervalMs(this.deps.loadConfig()));
      return;
    }
    await this.fetch(false);
  }

  private async fetch(fresh: boolean): Promise<void> {
    this.inFlight = true;
    try {
      const cfg = this.deps.loadConfig();
      const sig = configSignature(cfg);
      const staleConfig = this.lastConfigSig !== null && this.lastConfigSig !== sig;
      this.lastConfigSig = sig;

      const args = fresh ? { fresh: true } : {};
      let model: ViewModelResult;
      try {
        model = await this.deps.coreApi.getViewModel(args);
      } catch {
        // coreApi.getViewModel never throws (it returns {error}), but a
        // defensive catch keeps the poller alive if the facade contract is
        // ever violated. Emit an error payload and keep the schedule.
        model = { error: "poller: unexpected fetch failure" };
      }

      const fetchedAt = this.deps.now();
      const ms = intervalMs(cfg);
      const payload: PushPayload = {
        model,
        fetchedAt,
        nextFetchAt: fetchedAt + ms,
        ...(staleConfig ? { staleConfig: true } : {}),
      };
      this.broadcast(payload);
      this.scheduleNext(ms);
    } finally {
      this.inFlight = false;
      if (this.forcePending) {
        this.forcePending = false;
        const resolver = this.forceResolver;
        this.forceResolver = null;
        // Chain the force onto the current cycle's completion so the caller
        // (forceRefresh) resolves only after the forced fetch broadcasts.
        void this.fetch(true).then(() => resolver?.());
      }
    }
  }

  private broadcast(payload: PushPayload): void {
    for (const win of this.deps.getAllWindows()) {
      // Skip destroyed windows — getAllWindows can include windows mid-close.
      if (!win.isDestroyed()) {
        win.webContents.send(CHANNELS.push, payload);
      }
    }
  }
}

// Singleton wired to the real Electron + core facade. Lazily constructed so
// importing this module under test (VITEST is set) does not touch Electron.
let singleton: StatusPoller | null = null;

export function getPoller(): StatusPoller {
  if (singleton === null) {
    singleton = new StatusPoller({
      coreApi,
      loadConfig: () => coreApi.getConfig(),
      getAllWindows: () => BrowserWindow.getAllWindows(),
      now: () => Date.now(),
    });
  }
  return singleton;
}

export function resetPollerForTest(): void {
  if (singleton !== null) {
    singleton.stop();
    singleton = null;
  }
}