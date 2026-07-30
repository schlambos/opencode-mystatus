import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPrefs, PushPayload } from "../../shared/ipc";

const PREFS_FIXTURE: DesktopPrefs = {
  threshold: 25,
  trendMode: undefined,
  notifications: true,
  notifyCooldownMin: 60,
  lastTab: undefined,
  windowBounds: undefined,
  launchAtLogin: false,
};

interface FakeBridge {
  ping: () => Promise<string>;
  onViewModel: (cb: (payload: unknown) => void) => () => void;
  getConfig: () => Promise<unknown>;
  getPrefs: () => Promise<unknown>;
  patchConfig: (patch: unknown) => Promise<unknown>;
  patchPrefs: (patch: unknown) => Promise<unknown>;
}

function makeFixturePayload(): PushPayload {
  const now = Date.now();
  return {
    model: {
      summary: { accounts: 2, green: 1, yellow: 1, red: 0 },
      providers: [
        { name: "Ollama Cloud", minRemaining: 99, windows: [{ label: "Session", remaining: 99 }] },
        { name: "Poe Account Quota", minRemaining: 46, windows: [{ label: "Monthly", remaining: 46 }] },
      ],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [],
      health: { queried: 2, rendered: 2, stale: 0, failed: 0, unconfigured: 0 },
    },
    fetchedAt: now,
    nextFetchAt: now + 60_000,
  };
}

describe("status store", () => {
  let pushCallback: ((payload: unknown) => void) | null;
  let getConfigCalls: number;
  let configFixture: Record<string, unknown>;
  let prefsFixture: DesktopPrefs;
  let patchConfigCalls: unknown[];
  let patchPrefsCalls: unknown[];
  let bridge: FakeBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    pushCallback = null;
    getConfigCalls = 0;
    configFixture = { sort: "urgency" };
    prefsFixture = { ...PREFS_FIXTURE };
    patchConfigCalls = [];
    patchPrefsCalls = [];
    bridge = {
      ping: () => Promise.resolve("pong"),
      onViewModel: (cb) => {
        pushCallback = cb;
        return () => {
          pushCallback = null;
        };
      },
      getConfig: () => {
        getConfigCalls += 1;
        return Promise.resolve(configFixture);
      },
      getPrefs: () => Promise.resolve(prefsFixture),
      patchConfig: (patch) => {
        patchConfigCalls.push(patch);
        configFixture = { ...configFixture, ...(patch as Record<string, unknown>) };
        return Promise.resolve(configFixture);
      },
      patchPrefs: (patch) => {
        patchPrefsCalls.push(patch);
        prefsFixture = { ...prefsFixture, ...(patch as Partial<DesktopPrefs>) };
        return Promise.resolve(prefsFixture);
      },
    };
    vi.stubGlobal("window", { mystatus: bridge });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function freshStore() {
    return import("./store");
  }

  it("starts connecting with no data", async () => {
    const store = await freshStore();
    expect(store.getStatusState()).toMatchObject({
      model: null,
      fetchedAt: null,
      nextFetchAt: null,
      connection: "connecting",
      payloadError: null,
      modelError: null,
    });
  });

  it("accepts a valid pushed view model", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    const payload = makeFixturePayload();

    pushCallback?.(payload);

    const state = store.getStatusState();
    expect(state.model).toEqual(payload.model);
    expect(state.fetchedAt).toBe(payload.fetchedAt);
    expect(state.nextFetchAt).toBe(payload.nextFetchAt);
    expect(state.connection).toBe("live");
    expect(state.payloadError).toBeNull();
    expect(state.modelError).toBeNull();
    store.disconnectStatusStore();
  });

  it("surfaces an error result but keeps the previous model", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    pushCallback?.(makeFixturePayload());
    const before = store.getStatusState().model;

    pushCallback?.({
      model: { error: "all providers timed out" },
      fetchedAt: Date.now(),
      nextFetchAt: Date.now() + 60_000,
    });

    const state = store.getStatusState();
    expect(state.model).toBe(before);
    expect(state.modelError).toBe("all providers timed out");
    expect(state.payloadError).toBeNull();
    store.disconnectStatusStore();
  });

  it("rejects a structurally invalid payload and keeps prior data", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    pushCallback?.(makeFixturePayload());
    const before = store.getStatusState().model;

    pushCallback?.({ fetchedAt: 1, nextFetchAt: 2 });

    const state = store.getStatusState();
    expect(state.model).toBe(before);
    expect(state.payloadError).toContain("model");
    store.disconnectStatusStore();
  });

  it("rejects a payload with non-numeric fetchedAt", async () => {
    const store = await freshStore();
    store.connectStatusStore();

    pushCallback?.({ model: { summary: {}, providers: [] }, fetchedAt: "x", nextFetchAt: 2 });

    expect(store.getStatusState().payloadError).toContain("fetchedAt");
    store.disconnectStatusStore();
  });

  it("degrades gracefully when the preload bridge never loaded", async () => {
    vi.stubGlobal("window", {});
    const store = await freshStore();

    store.connectStatusStore()();

    expect(store.getStatusState().connection).toBe("error");
    expect(store.getStatusState().payloadError).toContain("bridge unavailable");
  });

  it("marks the connection live once ping resolves", async () => {
    const store = await freshStore();
    store.connectStatusStore();

    await vi.advanceTimersByTimeAsync(0);

    expect(store.getStatusState().connection).toBe("live");
    store.disconnectStatusStore();
  });

  it("marks the connection error when ping rejects", async () => {
    bridge.ping = () => Promise.reject(new Error("no handler"));
    const store = await freshStore();
    store.connectStatusStore();

    await vi.advanceTimersByTimeAsync(0);

    expect(store.getStatusState().connection).toBe("error");
    store.disconnectStatusStore();
  });

  it("ticks `now` once per second while subscribed, and stops after the last unsubscribe", async () => {
    const store = await freshStore();
    const initial = store.getStatusState().now;
    let renders = 0;

    const unsubscribe = store.subscribeStatusStore(() => {
      renders += 1;
    });
    await vi.advanceTimersByTimeAsync(3000);
    unsubscribe();

    expect(store.getStatusState().now - initial).toBeGreaterThanOrEqual(3000);
    expect(renders).toBe(3);

    const frozen = store.getStatusState().now;
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getStatusState().now).toBe(frozen);
  });

  it("snapshots config on connect", async () => {
    const store = await freshStore();
    store.connectStatusStore();

    await vi.advanceTimersByTimeAsync(0);

    expect(store.getStatusState().config).toEqual({ sort: "urgency" });
    expect(getConfigCalls).toBe(1);
    store.disconnectStatusStore();
  });

  it("re-fetches config when a push flags staleConfig", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    await vi.advanceTimersByTimeAsync(0);

    pushCallback?.({ ...makeFixturePayload(), staleConfig: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(getConfigCalls).toBe(2);
    store.disconnectStatusStore();
  });

  it("never crashes when getConfig rejects", async () => {
    bridge.getConfig = () => Promise.reject(new Error("boom"));
    const store = await freshStore();
    store.connectStatusStore();

    await vi.advanceTimersByTimeAsync(0);

    expect(store.getStatusState().config).toBeNull();
    store.disconnectStatusStore();
  });
});

describe("dashboard controls (todo 8)", () => {
  let pushCallback: ((payload: unknown) => void) | null;
  let configFixture: Record<string, unknown>;
  let prefsFixture: DesktopPrefs;
  let patchConfigCalls: unknown[];
  let patchPrefsCalls: unknown[];
  let bridge: FakeBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    pushCallback = null;
    configFixture = { sort: "name", trend: "full" };
    prefsFixture = { ...PREFS_FIXTURE, threshold: 30 };
    patchConfigCalls = [];
    patchPrefsCalls = [];
    bridge = {
      ping: () => Promise.resolve("pong"),
      onViewModel: (cb) => {
        pushCallback = cb;
        return () => {
          pushCallback = null;
        };
      },
      getConfig: () => Promise.resolve(configFixture),
      getPrefs: () => Promise.resolve(prefsFixture),
      patchConfig: (patch) => {
        patchConfigCalls.push(patch);
        configFixture = { ...configFixture, ...(patch as Record<string, unknown>) };
        return Promise.resolve(configFixture);
      },
      patchPrefs: (patch) => {
        patchPrefsCalls.push(patch);
        prefsFixture = { ...prefsFixture, ...(patch as Partial<DesktopPrefs>) };
        return Promise.resolve(prefsFixture);
      },
    };
    vi.stubGlobal("window", { mystatus: bridge });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function freshStore() {
    return import("./store");
  }

  it("initializes session controls from config sort/trend and prefs threshold", async () => {
    const store = await freshStore();
    store.connectStatusStore();

    await vi.advanceTimersByTimeAsync(0);

    expect(store.getStatusState().prefs).toEqual(prefsFixture);
    expect(store.getStatusState().controls).toEqual({
      sortMode: "name",
      trendMode: "full",
      threshold: 30,
    });
    store.disconnectStatusStore();
  });

  it("falls back to defaults when config and prefs are unavailable", async () => {
    bridge.getConfig = () => Promise.reject(new Error("no config"));
    bridge.getPrefs = () => Promise.reject(new Error("no prefs"));
    const store = await freshStore();
    store.connectStatusStore();

    await vi.advanceTimersByTimeAsync(0);

    expect(store.getStatusState().controls).toEqual({
      sortMode: "urgency",
      trendMode: "compact",
      threshold: 25,
    });
    store.disconnectStatusStore();
  });

  it("setters change session state without writing to either destination", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    await vi.advanceTimersByTimeAsync(0);

    store.setSortMode("reset");
    store.setTrendMode("off");
    store.setThreshold(40);

    const state = store.getStatusState();
    expect(state.controls).toEqual({ sortMode: "reset", trendMode: "off", threshold: 40 });
    expect(patchConfigCalls).toHaveLength(0);
    expect(patchPrefsCalls).toHaveLength(0);
    store.disconnectStatusStore();
  });

  it("saveControlsAsDefaults writes sort+trend to config and threshold to prefs — never threshold to config", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    await vi.advanceTimersByTimeAsync(0);

    store.setSortMode("reset");
    store.setTrendMode("off");
    store.setThreshold(40);
    await store.saveControlsAsDefaults();

    expect(patchConfigCalls).toEqual([{ sort: "reset", trend: "off" }]);
    expect(patchConfigCalls[0]).not.toHaveProperty("threshold");
    expect(patchPrefsCalls).toEqual([{ threshold: 40 }]);
    const state = store.getStatusState();
    expect(state.controlsSaving).toBe(false);
    expect(state.controlsNotice).toEqual({ kind: "saved", text: "Saved as defaults" });
    expect(state.config).toMatchObject({ sort: "reset", trend: "off" });
    expect(state.prefs?.threshold).toBe(40);
    store.disconnectStatusStore();
  });

  it("reports a failed destination but keeps session controls active", async () => {
    bridge.patchConfig = (patch) => {
      patchConfigCalls.push(patch);
      return Promise.reject(new Error("mystatus.json is corrupt"));
    };
    const store = await freshStore();
    store.connectStatusStore();
    await vi.advanceTimersByTimeAsync(0);

    store.setSortMode("reset");
    store.setThreshold(40);
    await store.saveControlsAsDefaults();

    const state = store.getStatusState();
    expect(state.controlsNotice?.kind).toBe("error");
    expect(state.controlsNotice?.text).toContain("mystatus.json");
    expect(state.controls.sortMode).toBe("reset");
    expect(state.controls.threshold).toBe(40);
    expect(state.prefs?.threshold).toBe(40);
    expect(patchPrefsCalls).toEqual([{ threshold: 40 }]);
    store.disconnectStatusStore();
  });

  it("keeps controls session-only with a notice when the bridge is unavailable", async () => {
    vi.stubGlobal("window", {});
    const store = await freshStore();
    store.connectStatusStore();

    store.setThreshold(40);
    await store.saveControlsAsDefaults();

    const state = store.getStatusState();
    expect(state.controls.threshold).toBe(40);
    expect(state.controlsNotice?.kind).toBe("error");
    expect(state.controlsNotice?.text).toContain("session");
    store.disconnectStatusStore();
  });

  it("pushed payloads still land while controls are in flight", async () => {
    const store = await freshStore();
    store.connectStatusStore();
    await vi.advanceTimersByTimeAsync(0);

    store.setThreshold(40);
    const payload = makeFixturePayload();
    pushCallback?.(payload);

    expect(store.getStatusState().model).toEqual(payload.model);
    expect(store.getStatusState().controls.threshold).toBe(40);
    store.disconnectStatusStore();
  });
});
