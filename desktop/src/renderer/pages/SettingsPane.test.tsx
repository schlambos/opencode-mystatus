// @vitest-environment jsdom
// SettingsPane (todo 14): the page binds to mystatus.json via the strict
// inspect/save bridge (never the shallow-merge patchConfig), sends fully
// formed providers payloads that preserve on-disk hidden state, refuses to
// overwrite a corrupt file until an explicit reset, and routes the Desktop
// app section exclusively to mystatus-desktop.json.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopPrefs } from "../../shared/ipc";

const CONFIG_PATH = "/tmp/mystatus-ipc-fixture/.config/opencode/mystatus.json";

const PREFS_FIXTURE: DesktopPrefs = {
  threshold: 25,
  trendMode: undefined,
  notifications: true,
  notifyCooldownMin: 60,
  lastTab: undefined,
  windowBounds: undefined,
  launchAtLogin: false,
};

interface BridgeState {
  push: ((payload: unknown) => void) | null;
  configFixture: Record<string, unknown>;
  prefsFixture: DesktopPrefs;
  corrupt: boolean;
  inspectCalls: number;
  saveCalls: Record<string, unknown>[];
  prefsPatchCalls: Record<string, unknown>[];
  resetCalls: number;
  revealCalls: string[];
  rejectSave: string | null;
  envStatusFixture: {
    baseUrlFromEnv: boolean;
    apiKeyFromEnv: boolean;
    adminPasswordFromEnv: boolean;
    usageHoursFromEnv: boolean;
    guiConfigFound: boolean;
    guiConfigPath: string;
  } | null;
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
      state.configFixture = { ...state.configFixture, ...(patch as Record<string, unknown>) };
      return Promise.resolve(state.configFixture);
    },
    patchPrefs: (patch: Record<string, unknown>) => {
      state.prefsPatchCalls.push(patch);
      state.prefsFixture = { ...state.prefsFixture, ...patch };
      return Promise.resolve(state.prefsFixture);
    },
    inspectConfig: () => {
      state.inspectCalls++;
      if (state.corrupt) {
        return Promise.resolve({ status: "corrupt", path: CONFIG_PATH, error: "Unexpected token 'n'" });
      }
      return Promise.resolve({ status: "ok", path: CONFIG_PATH, config: state.configFixture });
    },
    saveConfigSections: (sections: Record<string, unknown>) => {
      state.saveCalls.push(sections);
      if (state.rejectSave !== null) return Promise.reject(new Error(state.rejectSave));
      const merged: Record<string, unknown> = { ...state.configFixture, ...sections };
      const patchProviders = sections["providers"] as Record<string, unknown> | undefined;
      if (patchProviders !== undefined) {
        const diskProviders = (state.configFixture["providers"] ?? {}) as Record<string, unknown>;
        merged["providers"] = { ...diskProviders, ...patchProviders };
      }
      state.configFixture = merged;
      return Promise.resolve(state.configFixture);
    },
    resetConfig: () => {
      state.resetCalls++;
      state.corrupt = false;
      state.configFixture = {};
      return Promise.resolve({});
    },
    revealPath: (target: string) => {
      state.revealCalls.push(target);
      return Promise.resolve();
    },
    getAntigravityEnvStatus: () => Promise.resolve(state.envStatusFixture),
    getViewModel: () => Promise.resolve({ error: "not used" }),
    getExport: () => Promise.resolve({ format: "json" as const, text: "" }),
    refresh: () => Promise.resolve(),
  };
}

describe("SettingsPane", () => {
  let bridgeState: BridgeState;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    bridgeState = {
      push: null,
      configFixture: {
        sort: "name",
        trend: "full",
        watchIntervalSec: 90,
        providers: { disabled: ["xai"], hidden: ["poe"] },
        antigravityTools: { usageHours: 24 },
      },
      prefsFixture: { ...PREFS_FIXTURE },
      corrupt: false,
      inspectCalls: 0,
      saveCalls: [],
      prefsPatchCalls: [],
      resetCalls: 0,
      revealCalls: [],
      rejectSave: null,
      envStatusFixture: {
        baseUrlFromEnv: false,
        apiKeyFromEnv: true,
        adminPasswordFromEnv: false,
        usageHoursFromEnv: false,
        guiConfigFound: true,
        guiConfigPath: "/tmp/mystatus-ipc-fixture/.antigravity_tools/gui_config.json",
      },
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

  async function renderPane() {
    const store = await import("../lib/store");
    const { SettingsPane } = await import("./SettingsPane");
    await act(async () => {
      store.connectStatusStore();
      render(<SettingsPane />);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("initializes every section from the on-disk config", async () => {
    await renderPane();

    expect(screen.getByTestId("settings-sort-name")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("settings-trend-full")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("settings-watch-interval")).toHaveProperty("value", "90");
    expect(screen.getByTestId("settings-agt-hours")).toHaveProperty("value", "24");
    expect(screen.getByTestId("provider-toggle-xai")).toHaveProperty("checked", false);
    expect(screen.getByTestId("provider-toggle-anthropic")).toHaveProperty("checked", true);
    expect(screen.getAllByTestId(/^provider-toggle-/)).toHaveLength(18);
    expect(screen.getByTestId("providers-enabled-count").textContent).toBe("17/18 enabled");
    expect(screen.getByTestId("settings-footer").textContent).toContain(CONFIG_PATH);
    expect(screen.getByTestId("comments-warning")).toBeDefined();
    expect(screen.getByTestId("prefs-threshold")).toHaveProperty("value", "25");
  });

  it("saves a fully-formed providers payload with the exact disabled array, preserving hidden", async () => {
    await renderPane();

    await act(async () => {
      fireEvent.click(screen.getByTestId("provider-toggle-poe"));
    });
    expect(screen.getByTestId("provider-toggle-poe")).toHaveProperty("checked", false);

    await act(async () => {
      fireEvent.click(screen.getByTestId("section-providers-save"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridgeState.saveCalls).toHaveLength(1);
    expect(bridgeState.saveCalls[0]).toEqual({
      providers: { disabled: ["xai", "poe"], order: [], hidden: ["poe"] },
    });
    expect(screen.getByTestId("section-providers-notice").textContent).toBe("Saved");
    expect(screen.queryByTestId("comments-warning")).toBeNull();
  });

  it("re-reads the config before every save", async () => {
    await renderPane();
    const before = bridgeState.inspectCalls;

    await act(async () => {
      fireEvent.click(screen.getByTestId("provider-toggle-ollama"));
      fireEvent.click(screen.getByTestId("section-providers-save"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridgeState.inspectCalls).toBeGreaterThan(before);
  });

  it("blocks the save while an interval is below the enforced minimum", async () => {
    await renderPane();

    await act(async () => {
      fireEvent.change(screen.getByTestId("settings-watch-interval"), { target: { value: "3" } });
    });

    expect(screen.getByTestId("section-polling-problems").textContent).toContain("at least 5s");
    expect(screen.getByTestId("section-polling-save")).toHaveProperty("disabled", true);
    expect(bridgeState.saveCalls).toHaveLength(0);
  });

  it("refuses to overwrite a corrupt config until an explicit reset", async () => {
    bridgeState.corrupt = true;
    await renderPane();

    expect(screen.getByTestId("settings-corrupt").textContent).toContain("not parseable");
    expect(screen.queryByTestId("section-output")).toBeNull();
    expect(bridgeState.saveCalls).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId("corrupt-reset"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridgeState.resetCalls).toBe(1);
    expect(screen.getByTestId("section-output")).toBeDefined();
    expect(screen.getByTestId("provider-toggle-xai")).toHaveProperty("checked", true);
  });

  it("detects corruption discovered at save time and stops the write", async () => {
    await renderPane();

    await act(async () => {
      fireEvent.click(screen.getByTestId("provider-toggle-ollama"));
    });
    bridgeState.corrupt = true;
    await act(async () => {
      fireEvent.click(screen.getByTestId("section-providers-save"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridgeState.saveCalls).toHaveLength(0);
    expect(screen.getByTestId("settings-corrupt")).toBeDefined();
  });

  it("routes the Desktop app section to patchPrefs only, never to mystatus.json", async () => {
    await renderPane();

    await act(async () => {
      fireEvent.change(screen.getByTestId("prefs-threshold"), { target: { value: "40" } });
      fireEvent.click(screen.getByTestId("prefs-notifications"));
    });
    expect(screen.getByTestId("prefs-threshold-value").textContent).toContain("< 40%");

    await act(async () => {
      fireEvent.click(screen.getByTestId("section-prefs-save"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridgeState.prefsPatchCalls).toEqual([
      { threshold: 40, notifications: false, notifyCooldownMin: 60, launchAtLogin: false },
    ]);
    expect(bridgeState.saveCalls).toHaveLength(0);
    expect(screen.getByTestId("section-prefs-notice").textContent).toBe("Saved");
  });

  it("requests strict reveal targets from the footer", async () => {
    await renderPane();

    await act(async () => {
      fireEvent.click(screen.getByTestId("reveal-config"));
      fireEvent.click(screen.getByTestId("reveal-prefs"));
    });

    expect(bridgeState.revealCalls).toEqual(["config", "prefs"]);
  });

  it("surfaces a failed save and recovers on retry", async () => {
    bridgeState.rejectSave = "disk locked";
    await renderPane();

    await act(async () => {
      fireEvent.click(screen.getByTestId("settings-summary"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("section-output-save"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("section-output-notice").textContent).toContain("disk locked");

    bridgeState.rejectSave = null;
    await act(async () => {
      fireEvent.click(screen.getByTestId("section-output-save"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("section-output-notice").textContent).toBe("Saved");
    expect(bridgeState.saveCalls.at(-1)).toEqual({ sort: "name", summary: false, trend: "full" });
  });

  it("renders from-env badges and gui_config discovery status from the env IPC", async () => {
    await renderPane();

    // apiKey is set in the fixture → badge present; adminPassword/baseUrl/usageHours unset → absent.
    expect(screen.getByTestId("settings-agt-api-key-from-env")).toBeDefined();
    expect(screen.queryByTestId("settings-agt-admin-password-from-env")).toBeNull();
    expect(screen.queryByTestId("settings-agt-base-url-from-env")).toBeNull();
    expect(screen.queryByTestId("settings-agt-hours-from-env")).toBeNull();
    // gui_config.json found in the fixture → found state.
    expect(screen.getByTestId("settings-agt-gui-config-found")).toBeDefined();
  });

  it("shows the missing-gui_config state when discovery reports not found", async () => {
    bridgeState.envStatusFixture = {
      baseUrlFromEnv: false,
      apiKeyFromEnv: false,
      adminPasswordFromEnv: false,
      usageHoursFromEnv: false,
      guiConfigFound: false,
      guiConfigPath: "/tmp/mystatus-ipc-fixture/.antigravity_tools/gui_config.json",
    };
    await renderPane();

    expect(screen.getByTestId("settings-agt-gui-config-missing")).toBeDefined();
    expect(screen.queryByTestId("settings-agt-api-key-from-env")).toBeNull();
  });

  it("shows the checking state when the env IPC rejects", async () => {
    bridgeState.envStatusFixture = null;
    const failingBridge = makeBridge(bridgeState);
    failingBridge.getAntigravityEnvStatus = () => Promise.reject(new Error("no handler"));
    vi.stubGlobal("window", { mystatus: failingBridge });
    vi.resetModules();

    await renderPane();

    expect(screen.getByTestId("settings-agt-gui-config-unknown")).toBeDefined();
  });
});
