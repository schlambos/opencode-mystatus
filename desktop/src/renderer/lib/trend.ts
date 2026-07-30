// Trend engine for the renderer — a structured reimplementation of the
// core's makeTrendFn (plugin/mystatus.ts:6989-7033) so sparklines, deltas,
// and projections render identically to the one-shot/TUI output.
//
// Series key derivation (do not change without re-reading the core):
//   recordSnapshot keys history values as `${m.cellTitle}::${m.label}`
//   (plugin/mystatus.ts:7046) and makeTrendFn looks up the same composite
//   (plugin/mystatus.ts:6998). The view model carries both halves verbatim:
//   provider.name === cell.title === WindowMetric.cellTitle
//   (plugin/mystatus.ts:7370, 6291, 6254) and window.label ===
//   WindowMetric.label === `w.trendKey ?? w.label` (plugin/mystatus.ts:7374,
//   6280). Hence seriesKey(provider.name, window.label) matches the core
//   exactly — no guessing.
// PARITY: plugin/mystatus.ts:6936-7053 — re-verify if the core changes.

import type { HistorySnapshot, TrendMode } from "../../shared/ipc.js";
import type { StatusTone } from "./status";

export interface TrendPoint {
  ts: number;
  value: number;
}

export function seriesKey(providerName: string, windowLabel: string): string {
  return `${providerName}::${windowLabel}`;
}

// PARITY: plugin/mystatus.ts:6977-6987 (buildSeries).
export function buildSeriesMap(snapshots: HistorySnapshot[]): Map<string, TrendPoint[]> {
  const map = new Map<string, TrendPoint[]>();
  for (const snap of snapshots) {
    for (const [key, value] of Object.entries(snap.values)) {
      const arr = map.get(key);
      if (arr) arr.push({ ts: snap.ts, value });
      else map.set(key, [{ ts: snap.ts, value }]);
    }
  }
  return map;
}

// PARITY: plugin/mystatus.ts:246-257 (formatDuration — the CORE formatter,
// not the TUI's fmtDur; it keeps every non-zero unit and falls back to "0m").
export function formatCoreDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "-";
  const sec = Math.max(0, totalSeconds);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

// PARITY: plugin/mystatus.ts:6971 — spark color thresholds are fixed at
// 50/25 in the core (independent of the alert threshold).
export function sparkTone(value: number): StatusTone {
  if (value >= 50) return "ok";
  if (value >= 25) return "warn";
  return "dead";
}

/** Trend modes that render something (shared TrendMode minus "off"). */
export type ActiveTrendMode = Exclude<TrendMode, "off">;

export type DeltaKind = "drain" | "gain" | "reset" | "flat";

export interface TrendView {
  /** ≤10 values ending in the current remaining (core: slice(-10)). */
  points: number[];
  /** "▼3%/2h" · "▲4%" · "↑ reset" · "→ 0%" — null with no history yet. */
  deltaText: string | null;
  deltaKind: DeltaKind | null;
  /** "~2d to empty" — full mode only, when depletion outruns the reset. */
  projectionText: string | null;
}

export interface ComputeTrendInput {
  series: TrendPoint[];
  remaining: number;
  resetMs: number | undefined;
  mode: ActiveTrendMode;
  nowMs: number;
}

// PARITY: plugin/mystatus.ts:6989-7033 (makeTrendFn). Null when the core
// would render no trend line at all: with no history the only point is the
// current value, and a one-point sparkline is never drawn (core: first run
// shows no trend).
export function computeTrend(input: ComputeTrendInput): TrendView | null {
  const { series, remaining, resetMs, mode, nowMs } = input;
  if (series.length === 0) return null;

  const recent = [...series.map((p) => p.value), remaining].slice(-10);
  const prev = series[series.length - 1];
  if (prev === undefined) return null;
  const delta = remaining - prev.value;
  const ageMs = nowMs - prev.ts;
  const ageStr = mode === "full" ? `/${formatCoreDuration(Math.floor(ageMs / 1000))}` : "";

  let deltaText: string;
  let deltaKind: DeltaKind;
  if (delta > 5) {
    deltaText = "\u2191 reset";
    deltaKind = "reset";
  } else if (delta >= 1) {
    deltaText = `\u25b2${delta}%${ageStr}`;
    deltaKind = "gain";
  } else if (delta <= -1) {
    deltaText = `\u25bc${Math.abs(delta)}%${ageStr}`;
    deltaKind = "drain";
  } else {
    deltaText = "\u2192 0%";
    deltaKind = "flat";
  }

  let projectionText: string | null = null;
  if (mode === "full" && delta < 0 && ageMs > 0) {
    const ratePerMs = (prev.value - remaining) / ageMs;
    if (ratePerMs > 0) {
      const msToEmpty = remaining / ratePerMs;
      if (resetMs === undefined || msToEmpty < resetMs) {
        projectionText = `~${formatCoreDuration(Math.floor(msToEmpty / 1000))} to empty`;
      }
    }
  }

  return { points: recent, deltaText, deltaKind, projectionText };
}
