// @vitest-environment jsdom
// ControlsBar (todo 8): session controls apply instantly, persistence happens
// ONLY on "Save as defaults" — sort/trend to mystatus.json, threshold to
// mystatus-desktop.json — and a failed save degrades to session-only mode
// with a non-blocking notice instead of breaking the controls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopPrefs, PushPayload } from "../../shared/ipc";

const PREFS_FIXTURE: DesktopPrefs = {
  threshold: 30,
  trendMode: undefined,
  notifications: true,
  notifyCooldownMin: 60,
  lastTab: undefined,
  windowBounds: undefined,
  launchAtLogin: false,
};

function makePayload(): PushPayload {
  const now = Date.now();
  return {
    model: {
      summary: { accounts: 3, green: 1, yellow: 1, red: 1 },
      providers: [
        { name: "Poe Account Quota", minRemaining: 46, windows: [{ label: "Monthly", remaining: 46 }] },
        { name: "LongCat API Quota", minRemaining: 24, windows: [{ label: "Free quota", remaining: 24 }] },
        { name: "Ollama Cloud", minRemaining: 55, windows: [{ label: "Session", remaining: 55 }] },
      ],
      errors: [],
      alerts: [],
      threshold: 30,
      issues: [],
      health: { queried: 3, rendered: 3, stale: 0, failed: 0, unconfigured: 0 },
    },
    fetchedAt: now,
    nextFetchAt: now + 60_000,
  };
}

interface BridgeState {
  push: ((payload: unknown) => void) | null;
  patchConfigCalls: unknown[];
  patchPrefsCalls: unknown[];
  configFixture: Record<string, unknown>;
  prefsFixture: DesktopPrefs;
  rejectPatchConfig: boolean;
}

function makeBridge(state: BridgeState) {
  return {
    ping: () => Promise.resolve("pong"),
    onViewModel: (cb: (payload: unknown) => void) => {
      state.push = cb;
      return () => {
        state.push = null;
      };
    },
    getConfig: () => Promise.resolve(state.configFixture),
    getPrefs: () => Promise.resolve(state.prefsFixture),
    getHistory: () => Promise.resolve({ version: 1, snapshots: [] }),
    patchConfig: (patch: unknown) => {
      state.patchConfigCalls.push(patch);
      if (state.rejectPatchConfig) return Promise.reject(new Error("mystatus.json locked"));
      state.configFixture = { ...state.configFixture, ...(patch as Record<string, unknown>) };
      return Promise.resolve(state.configFixture);
    },
    patchPrefs: (patch: unknown) => {
      state.patchPrefsCalls.push(patch);
      state.prefsFixture = { ...state.prefsFixture, ...(patch as Partial<DesktopPrefs>) };
      return Promise.resolve(state.prefsFixture);
    },
    getViewModel: () => Promise.resolve({ error: "not used" }),
    getExport: () => Promise.resolve({ format: "json" as const, text: "" }),
    refresh: () => Promise.resolve(),
  };
}

describe("ControlsBar", () => {
  let bridgeState: BridgeState;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    bridgeState = {
      push: null,
      patchConfigCalls: [],
      patchPrefsCalls: [],
      configFixture: { sort: "name", trend: "full" },
      prefsFixture: { ...PREFS_FIXTURE },
      rejectPatchConfig: false,
    };
    vi.stubGlobal("window", { mystatus: makeBridge(bridgeState) });
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"];
  });

  async function renderBar() {
    const store = await import("../lib/store");
    const { ControlsBar } = await import("./ControlsBar");
    let view!: ReturnType<typeof render>;
    await act(async () => {
      store.connectStatusStore();
      view = render(<ControlsBar />);
      await vi.advanceTimersByTimeAsync(0);
      bridgeState.push?.(makePayload());
      await vi.advanceTimersByTimeAsync(0);
    });
    return { store, view };
  }

  it("initializes from persisted config sort/trend and prefs threshold", async () => {
    await renderBar();

    expect(screen.getByTestId("sort-name")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("trend-full")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("threshold-slider")).toHaveProperty("value", "30");
    expect(screen.getByTestId("threshold-value").textContent).toContain("< 30%");
  });

  it("applies control changes to the session without writing to either file", async () => {
    await renderBar();

    await act(async () => {
      fireEvent.click(screen.getByTestId("sort-reset"));
      fireEvent.click(screen.getByTestId("trend-off"));
      fireEvent.change(screen.getByTestId("threshold-slider"), { target: { value: "40" } });
    });

    expect(screen.getByTestId("sort-reset")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("trend-off")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("threshold-value").textContent).toContain("< 40%");
    expect(bridgeState.patchConfigCalls).toHaveLength(0);
    expect(bridgeState.patchPrefsCalls).toHaveLength(0);
  });

  it("re-buckets the live tallies as the slider crosses provider boundaries", async () => {
    // Providers at 24/46/55%. Threshold 30 → 1 red · 1 yellow · 1 green.
    await renderBar();
    expect(screen.getByTestId("tally-red").textContent).toBe("1");
    expect(screen.getByTestId("tally-yellow").textContent).toBe("1");
    expect(screen.getByTestId("tally-green").textContent).toBe("1");

    // Threshold 50 → 24% and 46% both fall below → 2 red · 0 yellow · 1 green.
    await act(async () => {
      fireEvent.change(screen.getByTestId("threshold-slider"), { target: { value: "50" } });
    });
    expect(screen.getByTestId("tally-red").textContent).toBe("2");
    expect(screen.getByTestId("tally-yellow").textContent).toBe("0");
    expect(screen.getByTestId("tally-green").textContent).toBe("1");
    expect(bridgeState.patchPrefsCalls).toHaveLength(0);
  });

  it("Save as defaults writes once per destination, splits the payload, then goes clean", async () => {
    await renderBar();

    await act(async () => {
      fireEvent.click(screen.getByTestId("sort-reset"));
      fireEvent.change(screen.getByTestId("threshold-slider"), { target: { value: "45" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-defaults"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridgeState.patchConfigCalls).toEqual([{ sort: "reset", trend: "full" }]);
    expect(bridgeState.patchConfigCalls[0]).not.toHaveProperty("threshold");
    expect(bridgeState.patchPrefsCalls).toEqual([{ threshold: 45 }]);
    expect(screen.getByTestId("controls-notice").textContent).toBe("Saved as defaults");
    expect(screen.getByTestId("save-defaults")).toHaveProperty("disabled", true);
  });

  it("keeps the controls usable in session-only mode when patchConfig is rejected", async () => {
    bridgeState.rejectPatchConfig = true;
    await renderBar();

    await act(async () => {
      fireEvent.click(screen.getByTestId("sort-urgency"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-defaults"));
      await vi.advanceTimersByTimeAsync(0);
    });

    const notice = screen.getByTestId("controls-notice");
    expect(notice.textContent).toContain("mystatus.json");

    // Session values survive the failed save and the bar still responds.
    await act(async () => {
      fireEvent.click(screen.getByTestId("sort-name"));
    });
    expect(screen.getByTestId("sort-name")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("controls-notice").textContent).toBe("");
  });
});
