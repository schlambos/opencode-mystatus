// Pure control logic for the dashboard ControlsBar (todo 8).
//
// PARITY: sorting mirrors core sortCells (plugin/mystatus.ts:7119-7137) and
// bucketing mirrors buildMyStatusViewModel's green/yellow/red tally
// (plugin/mystatus.ts:7339-7348). The view model is passed through verbatim,
// so provider.minRemaining === cellMinRemaining and provider.soonestResetMs
// === cellSoonestReset — the comparators below operate on those fields
// directly. Re-verify both sites if the core changes.

import type { DesktopPrefs, MyStatusConfig, MyStatusViewProvider, TrendMode } from "../../shared/ipc.js";

export type SortMode = "urgency" | "name" | "reset";

export const SORT_MODES: readonly SortMode[] = ["urgency", "name", "reset"];
export const TREND_MODES: readonly TrendMode[] = ["off", "compact", "full"];

export const THRESHOLD_MIN = 5;
export const THRESHOLD_MAX = 50;
export const THRESHOLD_STEP = 5;
export const DEFAULT_THRESHOLD = 25;

export interface ControlsSession {
  readonly sortMode: SortMode;
  readonly threshold: number;
  readonly trendMode: TrendMode;
}

export interface StatusTallies {
  readonly green: number;
  readonly yellow: number;
  readonly red: number;
}

export function defaultControls(): ControlsSession {
  return { sortMode: "urgency", threshold: DEFAULT_THRESHOLD, trendMode: "compact" };
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THRESHOLD;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value));
}

function byName(a: MyStatusViewProvider, b: MyStatusViewProvider): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Client-side re-sort with sortCells comparator semantics. Urgency keeps the
 * pushed model order: the core already ran sortCells("urgency") before
 * building providers (plugin/mystatus.ts:7307), so re-running the comparator
 * would be observationally identical.
 */
export function sortProviders(providers: readonly MyStatusViewProvider[], mode: SortMode): MyStatusViewProvider[] {
  const sorted = [...providers];
  if (mode === "name") {
    sorted.sort(byName);
  } else if (mode === "reset") {
    sorted.sort((a, b) => (a.soonestResetMs ?? Infinity) - (b.soonestResetMs ?? Infinity));
  }
  return sorted;
}

/** Green ≥50 · yellow ≥threshold · red below · >100 skipped (parity 7339-7348). */
export function bucketTallies(providers: readonly MyStatusViewProvider[], threshold: number): StatusTallies {
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const p of providers) {
    const min = p.minRemaining;
    if (min > 100) continue;
    if (min >= 50) green++;
    else if (min >= threshold) yellow++;
    else red++;
  }
  return { green, yellow, red };
}

/** Persisted baselines the session controls are measured against. */
export function controlsBaselines(config: MyStatusConfig | null, prefs: DesktopPrefs | null): ControlsSession {
  return {
    sortMode: config?.sort ?? "urgency",
    trendMode: config?.trend ?? "compact",
    threshold: clampThreshold(prefs?.threshold ?? DEFAULT_THRESHOLD),
  };
}

export function isControlsDirty(session: ControlsSession, baselines: ControlsSession): boolean {
  return (
    session.sortMode !== baselines.sortMode ||
    session.threshold !== baselines.threshold ||
    session.trendMode !== baselines.trendMode
  );
}
