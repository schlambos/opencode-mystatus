// Tests for the main-process polling service (todo 3).
//
// Uses vitest fake timers + a stub coreApi + a fake window list. No real
// Electron, no real network, no real filesystem. The poller is constructed
// directly with injected deps so the singleton path is never exercised here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusPoller, type PollerDeps } from "./poller.js";
import type { CoreApi } from "./core.js";
import type { MyStatusConfig, MyStatusViewModel, PushPayload, ViewModelResult } from "../shared/ipc.js";

interface FakeWindow {
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
}

function makeWindow(): FakeWindow & { sends: { channel: string; payload: unknown }[] } {
  const sends: { channel: string; payload: unknown }[] = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => {
        sends.push({ channel, payload });
      },
    },
    sends,
  };
}

function makeModel(): MyStatusViewModel {
  return {
    summary: { accounts: 1, green: 1, yellow: 0, red: 0 },
    providers: [{ name: "Test", minRemaining: 100, windows: [{ label: "Session", remaining: 100 }] }],
    errors: [],
    alerts: [],
    threshold: 25,
    issues: [],
    health: { queried: 1, rendered: 1, stale: 0, failed: 0, unconfigured: 0 },
  };
}

interface StubState {
  calls: { fresh: boolean }[];
  nextModel: ViewModelResult;
  delayMs: number;
  throwOnce: boolean;
  thrownAlready: boolean;
}

function makeStubCoreApi(state: StubState): CoreApi {
  const api = {
    getViewModel: (args: { fresh?: boolean }): Promise<ViewModelResult> => {
      state.calls.push({ fresh: args.fresh === true });
      if (state.throwOnce && !state.thrownAlready) {
        state.thrownAlready = true;
        return Promise.reject(new Error("stub boom"));
      }
      if (state.delayMs > 0) {
        return new Promise((r) => setTimeout(() => r(state.nextModel), state.delayMs));
      }
      return Promise.resolve(state.nextModel);
    },
    getJsonExport: () => Promise.resolve({ format: "json" as const, text: "" }),
    getAnsiExport: () => Promise.resolve({ format: "ansi" as const, text: "" }),
    getConfig: () => ({}),
    patchConfig: (p: unknown) => p,
  };
  return api as unknown as CoreApi;
}

function makeDeps(stub: StubState, windows: FakeWindow[], nowMs: () => number, cfg: MyStatusConfig = {}): PollerDeps {
  return {
    coreApi: makeStubCoreApi(stub),
    loadConfig: () => cfg,
    getAllWindows: () => windows as unknown as import("electron").BrowserWindow[],
    now: nowMs,
  };
}

describe("StatusPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks at the configured interval and pushes once per completed fetch", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    let now = 1000;
    const poller = new StatusPoller(makeDeps(stub, [win], () => now, { watchIntervalSec: 60 }));

    poller.start();
    // First fetch scheduled at 0ms.
    await vi.advanceTimersByTimeAsync(0);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.fresh).toBe(false);
    expect(win.sends).toHaveLength(1);
    const payload = win.sends[0]?.payload as PushPayload;
    expect(payload.model).toEqual(stub.nextModel);
    expect(payload.fetchedAt).toBe(1000);
    expect(payload.nextFetchAt).toBe(1000 + 60_000);
    expect(payload.staleConfig).toBeUndefined();

    // Advance to the next scheduled tick.
    now += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stub.calls).toHaveLength(2);
    expect(win.sends).toHaveLength(2);

    poller.stop();
  });

  it("clamps interval to a minimum of 5 seconds", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, { watchIntervalSec: 1 }));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.calls).toHaveLength(1);
    const payload = win.sends[0]?.payload as PushPayload;
    // 1s clamped to 5s.
    expect(payload.nextFetchAt - payload.fetchedAt).toBe(5_000);

    // 4s later: no second tick yet.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(stub.calls).toHaveLength(1);
    // 1s more: second tick fires.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stub.calls).toHaveLength(2);

    poller.stop();
  });

  it("defaults to 60s when watchIntervalSec is absent", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, {}));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const payload = win.sends[0]?.payload as PushPayload;
    expect(payload.nextFetchAt - payload.fetchedAt).toBe(60_000);
    poller.stop();
  });

  it("does not overlap fetches when a cycle is slow (single-flight)", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 90_000, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, { watchIntervalSec: 60 }));

    poller.start();
    // Kick off the first (slow) fetch.
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.calls).toHaveLength(1);
    expect(win.sends).toHaveLength(0); // still in flight

    // The scheduled next tick (60s) fires while the first fetch is still
    // running (it takes 90s). Because the timer callback is queued but the
    // fetch promise is unresolved, the second tick must NOT start a second
    // fetch — single-flight is enforced by the in-flight guard.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stub.calls).toHaveLength(1); // still only the first

    // Complete the slow fetch.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(stub.calls).toHaveLength(1);
    expect(win.sends).toHaveLength(1);
    poller.stop();
  });

  it("forceRefresh bypasses the schedule and runs immediately", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, { watchIntervalSec: 60 }));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.fresh).toBe(false);

    // Force a refresh well before the next scheduled tick.
    await poller.forceRefresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.fresh).toBe(true);
    expect(win.sends).toHaveLength(2);

    poller.stop();
  });

  it("forceRefresh requested mid-flight runs after the current cycle completes", async () => {
    // Use real timers for this test: the fire-and-forget force fetch creates
    // a multi-level microtask chain (finally → fetch(true) → getViewModel →
    // broadcast → resolver) that vitest fake timers cannot reliably drain.
    // Real timers + real microtasks make the chain deterministic.
    vi.useRealTimers();
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 30, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, { watchIntervalSec: 60 }));

    poller.start();
    // Let the first (slow) fetch start. delayMs=30ms real.
    await new Promise((r) => setTimeout(r, 5));
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.fresh).toBe(false);

    // Request a force while the first fetch is still in flight.
    await poller.forceRefresh();

    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.fresh).toBe(true);
    expect(win.sends).toHaveLength(2);
    poller.stop();
  });

  it("emits an error payload and keeps the schedule when the stub throws once", async () => {
    const stub: StubState = {
      calls: [],
      nextModel: makeModel(),
      delayMs: 0,
      throwOnce: true,
      thrownAlready: false,
    };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, { watchIntervalSec: 60 }));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    // The first fetch threw; the poller's defensive catch emits an error payload.
    expect(stub.calls).toHaveLength(1);
    expect(win.sends).toHaveLength(1);
    const errPayload = win.sends[0]?.payload as PushPayload;
    expect("error" in errPayload.model).toBe(true);
    expect((errPayload.model as { error: string }).error).toContain("poller");

    // The schedule continues: the next tick fires normally.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.fresh).toBe(false);
    const okPayload = win.sends[1]?.payload as PushPayload;
    expect("error" in okPayload.model).toBe(false);

    poller.stop();
  });

  it("does not poll when no windows and tray is not alive", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const poller = new StatusPoller(makeDeps(stub, [], () => 0, { watchIntervalSec: 60 }));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.calls).toHaveLength(0);

    // Even after the full interval, no fetch.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stub.calls).toHaveLength(0);

    poller.stop();
  });

  it("polls when tray is alive even with zero windows", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const poller = new StatusPoller(makeDeps(stub, [], () => 0, { watchIntervalSec: 60 }));

    poller.setTrayAlive(true);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(stub.calls).toHaveLength(1);
    poller.stop();
  });

  it("flags staleConfig when the config signature changes between ticks", async () => {
    let cfg: MyStatusConfig = { watchIntervalSec: 60, sort: "urgency" };
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller({
      coreApi: makeStubCoreApi(stub),
      loadConfig: () => cfg,
      getAllWindows: () => win ? [win as unknown as import("electron").BrowserWindow[]] : [],
      now: () => 0,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = win.sends[0]?.payload as PushPayload;
    expect(first.staleConfig).toBeUndefined();

    // Change the config; the next tick should flag staleConfig.
    cfg = { ...cfg, sort: "name" };
    await vi.advanceTimersByTimeAsync(60_000);
    const second = win.sends[1]?.payload as PushPayload;
    expect(second.staleConfig).toBe(true);

    // A third tick with no further change should NOT flag staleConfig.
    await vi.advanceTimersByTimeAsync(60_000);
    const third = win.sends[2]?.payload as PushPayload;
    expect(third.staleConfig).toBeUndefined();

    poller.stop();
  });

  it("skips destroyed windows when broadcasting", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const alive = makeWindow();
    const dead = makeWindow();
    dead.isDestroyed = () => true;
    const windows = [alive, dead];
    const poller = new StatusPoller({
      coreApi: makeStubCoreApi(stub),
      loadConfig: () => ({}),
      getAllWindows: () => windows as unknown as import("electron").BrowserWindow[],
      now: () => 0,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(alive.sends).toHaveLength(1);
    expect(dead.sends).toHaveLength(0);

    poller.stop();
  });

  it("start is idempotent and stop clears the timer", async () => {
    const stub: StubState = { calls: [], nextModel: makeModel(), delayMs: 0, throwOnce: false, thrownAlready: false };
    const win = makeWindow();
    const poller = new StatusPoller(makeDeps(stub, [win], () => 0, { watchIntervalSec: 60 }));

    poller.start();
    poller.start(); // idempotent
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.calls).toHaveLength(1);

    poller.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(stub.calls).toHaveLength(1);
  });
});