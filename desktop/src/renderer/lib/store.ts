// Tiny external store consumed via useSyncExternalStore (no new deps).
// Holds the latest pushed view model, sync timestamps, a config snapshot,
// and connection status. A single 1s interval (refcounted by subscribers)
// advances `now`; countdowns are derived per render as
// resetMs - (now - fetchedAt) — same math as the TUI (plugin/tui.ts:293-298).
//
// The renderer NEVER fetches data itself — everything arrives through the
// window.mystatus bridge (contextIsolation preserved).

import { useSyncExternalStore } from "react";
import type {
  ConfigPatch,
  DesktopPrefs,
  MyStatusConfig,
  MyStatusViewModel,
  TrendMode,
} from "../../shared/ipc.js";
import { describePayloadProblem, isPushPayload, isViewModel } from "../../shared/viewmodel.js";
import { getBridge, type RendererBridge } from "./bridge.js";
import {
  clampThreshold,
  controlsBaselines,
  defaultControls,
  type ControlsSession,
  type SortMode,
} from "./controls.js";

export type ConnectionStatus = "connecting" | "live" | "error";

export interface ControlsNotice {
  kind: "saved" | "error";
  text: string;
}

export interface StatusState {
  model: MyStatusViewModel | null;
  fetchedAt: number | null;
  nextFetchAt: number | null;
  config: MyStatusConfig | null;
  /** Desktop-only prefs (mystatus-desktop.json); null until the first read. */
  prefs: DesktopPrefs | null;
  connection: ConnectionStatus;
  /** Wall clock, ticked once per second while the store has subscribers. */
  now: number;
  /** Reason the last pushed payload was structurally rejected; null when healthy. */
  payloadError: string | null;
  /** Domain error from the core (`{error}` result); null when the last query succeeded. */
  modelError: string | null;
  /**
   * Session control values (todo 8). Apply to the view instantly but persist
   * ONLY via saveControlsAsDefaults — sort/trend to mystatus.json, threshold
   * to mystatus-desktop.json.
   */
  controls: ControlsSession;
  controlsSaving: boolean;
  controlsNotice: ControlsNotice | null;
}

const initialState: StatusState = {
  model: null,
  fetchedAt: null,
  nextFetchAt: null,
  config: null,
  prefs: null,
  connection: "connecting",
  now: Date.now(),
  payloadError: null,
  modelError: null,
  controls: defaultControls(),
  controlsSaving: false,
  controlsNotice: null,
};

let state: StatusState = { ...initialState };
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
let bridgeOff: (() => void) | null = null;
let configSettled = false;
let prefsSettled = false;
let controlsInitialized = false;

function patch(next: Partial<StatusState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeStatusStore(listener: () => void): () => void {
  listeners.add(listener);
  if (ticker === null) {
    ticker = setInterval(() => patch({ now: Date.now() }), 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

export function getStatusState(): StatusState {
  return state;
}

export function injectStatusSnapshot(next: {
  model: MyStatusViewModel;
  fetchedAt?: number;
  now?: number;
  config?: MyStatusConfig | null;
}): void {
  const t = next.now ?? Date.now();
  patch({
    model: next.model,
    fetchedAt: next.fetchedAt ?? t,
    now: t,
    nextFetchAt: null,
    config: next.config ?? {},
    prefs: null,
    connection: "live",
    modelError: null,
    payloadError: null,
  });
}

/** Subscribe from a component. Re-renders on every store patch (incl. the 1s tick). */
export function useStatusState(): StatusState {
  return useSyncExternalStore(subscribeStatusStore, getStatusState);
}

// Controls adopt the persisted baselines once both sources have settled
// (resolve OR reject), then stay user-owned — external config edits change
// the baseline (dirty flag) but never overwrite in-session choices.
function initControlsOnce(): void {
  if (controlsInitialized || !configSettled || !prefsSettled) return;
  controlsInitialized = true;
  patch({ controls: controlsBaselines(state.config, state.prefs) });
}

function refreshConfig(api: RendererBridge): void {
  void api
    .getConfig()
    .then((cfg) => {
      patch({ config: cfg });
      configSettled = true;
      initControlsOnce();
    })
    .catch(() => {
      configSettled = true;
      initControlsOnce();
    });
}

function refreshPrefs(api: RendererBridge): void {
  void api
    .getPrefs()
    .then((prefs) => {
      patch({ prefs });
      prefsSettled = true;
      initControlsOnce();
    })
    .catch(() => {
      prefsSettled = true;
      initControlsOnce();
    });
}

/** Re-read the config snapshot from main (e.g. after a dashboard mutation). */
export function reloadConfig(): void {
  const api = getBridge();
  if (api) refreshConfig(api);
}

/** Re-read desktop prefs from main (e.g. after a settings save). */
export function reloadPrefs(): void {
  const api = getBridge();
  if (api) refreshPrefs(api);
}

export function setSortMode(mode: SortMode): void {
  patch({ controls: { ...state.controls, sortMode: mode }, controlsNotice: null });
}

export function setTrendMode(mode: TrendMode): void {
  patch({ controls: { ...state.controls, trendMode: mode }, controlsNotice: null });
}

export function setThreshold(value: number): void {
  patch({ controls: { ...state.controls, threshold: clampThreshold(value) }, controlsNotice: null });
}

export function clearControlsNotice(): void {
  patch({ controlsNotice: null });
}

/**
 * "Save as defaults": the ONLY write path for the controls. sort/trend are
 * real MyStatusConfig keys → mystatus.json via patchConfig; threshold is
 * args-only in the core (plugin/mystatus.ts:7273) → mystatus-desktop.json
 * via patchPrefs. The two writes are independent — a partial failure keeps
 * the session values active and reports which destination failed.
 */
export async function saveControlsAsDefaults(): Promise<void> {
  const api = getBridge();
  if (!api) {
    patch({
      controlsNotice: {
        kind: "error",
        text: "Bridge unavailable — controls stay active for this session only",
      },
    });
    return;
  }

  const { controls } = state;
  patch({ controlsSaving: true, controlsNotice: null });

  const configPatch: ConfigPatch = { sort: controls.sortMode, trend: controls.trendMode };
  const [configResult, prefsResult] = await Promise.allSettled([
    api.patchConfig(configPatch),
    api.patchPrefs({ threshold: controls.threshold }),
  ]);

  const next: Partial<StatusState> = { controlsSaving: false };
  if (configResult.status === "fulfilled") next.config = configResult.value;
  if (prefsResult.status === "fulfilled") next.prefs = prefsResult.value;

  const failed: string[] = [];
  if (configResult.status === "rejected") failed.push("mystatus.json");
  if (prefsResult.status === "rejected") failed.push("desktop prefs");
  next.controlsNotice =
    failed.length === 0
      ? { kind: "saved", text: "Saved as defaults" }
      : {
          kind: "error",
          text: `Could not save to ${failed.join(" and ")} — controls stay active for this session`,
        };
  patch(next);
}

/**
 * Attach to the window.mystatus bridge: subscribe to pushed view models,
 * probe liveness with ping, and snapshot the config. Returns the teardown.
 */
export function connectStatusStore(): () => void {
  const api = getBridge();
  if (!api) {
    patch({
      connection: "error",
      payloadError: "window.mystatus bridge unavailable (preload script did not load)",
    });
    return () => undefined;
  }

  bridgeOff?.();
  bridgeOff = api.onViewModel((payload) => {
    if (!isPushPayload(payload)) {
      // Malformed payload: keep whatever data we have, surface a recoverable
      // error instead of crashing the render tree.
      patch({ connection: "live", payloadError: describePayloadProblem(payload) });
      return;
    }

    const base = {
      fetchedAt: payload.fetchedAt,
      nextFetchAt: payload.nextFetchAt,
      connection: "live" as const,
      payloadError: null,
    };
    const result = payload.model;
    if (isViewModel(result)) {
      patch({ ...base, model: result, modelError: null });
    } else {
      // Valid payload carrying a core error — keep the previous model (the
      // TUI shows stale data the same way) and surface the reason.
      patch({ ...base, modelError: result.error });
    }
    if (payload.staleConfig === true) refreshConfig(api);
  });

  void api
    .ping()
    .then(() => {
      if (state.connection === "connecting") patch({ connection: "live" });
    })
    .catch(() => {
      if (state.connection === "connecting") patch({ connection: "error" });
    });

  refreshConfig(api);
  refreshPrefs(api);

  return disconnectStatusStore;
}

export function disconnectStatusStore(): void {
  bridgeOff?.();
  bridgeOff = null;
  configSettled = false;
  prefsSettled = false;
  controlsInitialized = false;
}
