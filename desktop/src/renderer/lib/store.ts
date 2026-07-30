// Tiny external store consumed via useSyncExternalStore (no new deps).
// Holds the latest pushed view model, sync timestamps, a config snapshot,
// and connection status. A single 1s interval (refcounted by subscribers)
// advances `now`; countdowns are derived per render as
// resetMs - (now - fetchedAt) — same math as the TUI (plugin/tui.ts:293-298).
//
// The renderer NEVER fetches data itself — everything arrives through the
// window.mystatus bridge (contextIsolation preserved).

import { useSyncExternalStore } from "react";
import type { MyStatusConfig, MyStatusViewModel } from "../../shared/ipc.js";
import { describePayloadProblem, isPushPayload, isViewModel } from "../../shared/viewmodel.js";
import { getBridge, type RendererBridge } from "./bridge.js";

export type ConnectionStatus = "connecting" | "live" | "error";

export interface StatusState {
  model: MyStatusViewModel | null;
  fetchedAt: number | null;
  nextFetchAt: number | null;
  config: MyStatusConfig | null;
  connection: ConnectionStatus;
  /** Wall clock, ticked once per second while the store has subscribers. */
  now: number;
  /** Reason the last pushed payload was structurally rejected; null when healthy. */
  payloadError: string | null;
  /** Domain error from the core (`{error}` result); null when the last query succeeded. */
  modelError: string | null;
}

const initialState: StatusState = {
  model: null,
  fetchedAt: null,
  nextFetchAt: null,
  config: null,
  connection: "connecting",
  now: Date.now(),
  payloadError: null,
  modelError: null,
};

let state: StatusState = { ...initialState };
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
let bridgeOff: (() => void) | null = null;

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

/** Subscribe from a component. Re-renders on every store patch (incl. the 1s tick). */
export function useStatusState(): StatusState {
  return useSyncExternalStore(subscribeStatusStore, getStatusState);
}

function refreshConfig(api: RendererBridge): void {
  void api
    .getConfig()
    .then((cfg) => {
      patch({ config: cfg });
    })
    .catch(() => undefined);
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

  return disconnectStatusStore;
}

export function disconnectStatusStore(): void {
  bridgeOff?.();
  bridgeOff = null;
}
