import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "../../shared/ipc";

interface FakeBridge {
  ping: () => Promise<string>;
  onViewModel: (cb: (payload: unknown) => void) => () => void;
  getConfig: () => Promise<unknown>;
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
  let bridge: FakeBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    pushCallback = null;
    getConfigCalls = 0;
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
        return Promise.resolve({ sort: "urgency" });
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
