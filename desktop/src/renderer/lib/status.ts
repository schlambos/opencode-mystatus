// Status semantics shared by the renderer. Thresholds mirror the plugin's
// emoji tiers (plugin/mystatus.ts:55-60) and the TUI's threshold-aware meter
// color (plugin/tui.ts:193-197):
//   dead  ≤ 0        (🟥 / red)
//   low   < threshold (🟧 / orange)
//   warn  < 50        (🟨 / yellow)
//   ok    ≥ 50        (🟩 / green)

export type StatusTone = "ok" | "warn" | "low" | "dead";

// PARITY: plugin/mystatus.ts:48-60 + plugin/tui.ts:193-197 — re-verify if the core changes.
export function statusTone(pct: number, threshold: number): StatusTone {
  if (pct <= 0) return "dead";
  if (pct < threshold) return "low";
  if (pct < 50) return "warn";
  return "ok";
}

// Full literal class names (no interpolation) so Tailwind's scanner sees them.
export const toneDotClass: Record<StatusTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  low: "bg-status-low",
  dead: "bg-status-dead",
};

export const toneTextClass: Record<StatusTone, string> = {
  ok: "text-status-ok",
  warn: "text-status-warn",
  low: "text-status-low",
  dead: "text-status-dead",
};

export const toneFillClass: Record<StatusTone, string> = {
  ok: "fill-status-ok",
  warn: "fill-status-warn",
  low: "fill-status-low",
  dead: "fill-status-dead",
};

export const toneStrokeClass: Record<StatusTone, string> = {
  ok: "stroke-status-ok",
  warn: "stroke-status-warn",
  low: "stroke-status-low",
  dead: "stroke-status-dead",
};

// PARITY: plugin/tui.ts:180-187 (fmtDur) — "1d 2h", "3h 12m", "45m".
export function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// PARITY: plugin/tui.ts:189-191 (fmtAge) — "12s", "5m", "16h".
export function formatAge(sec: number): string {
  return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;
}

export interface ResetCountdown {
  /** Milliseconds left until the window resets; 0 when it is resetting now. */
  leftMs: number;
  text: string;
}

// PARITY: plugin/tui.ts:293-298 (resetText) + 638 (ageMs = now - fetchedAt).
// Remaining time is derived — never stored — as resetMs - (now - fetchedAt),
// which is exactly the TUI's per-tick math.
export function resetCountdown(
  resetMs: number | undefined,
  fetchedAt: number | null,
  now: number,
): ResetCountdown | null {
  if (typeof resetMs !== "number" || !Number.isFinite(resetMs) || resetMs <= 0) return null;
  const ageMs = fetchedAt === null ? 0 : Math.max(0, now - fetchedAt);
  const left = resetMs - ageMs;
  if (left <= 0) return { leftMs: 0, text: "now" };
  return { leftMs: left, text: formatDuration(Math.floor(left / 1000)) };
}

export function viewMinRemaining(windows: ReadonlyArray<{ remaining: number }>): number | null {
  if (windows.length === 0) return null;
  let min = windows[0]!.remaining;
  for (let i = 1; i < windows.length; i++) {
    const r = windows[i]!.remaining;
    if (r < min) min = r;
  }
  return min;
}

/**
 * Core uses minRemaining=101 as a "no meters" sentinel (cellMinRemaining).
 * Never treat values >100 as a real remaining percentage in the UI.
 */
export function effectiveRemaining(
  windows: ReadonlyArray<{ remaining: number }>,
  minRemaining?: number,
): number | null {
  const fromWindows = viewMinRemaining(windows);
  if (fromWindows !== null) return fromWindows;
  if (typeof minRemaining === "number" && Number.isFinite(minRemaining) && minRemaining <= 100) {
    return minRemaining;
  }
  return null;
}

export interface OffTabWorstCue {
  horizonLabel: string;
  remaining: number;
  windowLabel: string;
}

export function offTabWorstCue(
  allWindows: ReadonlyArray<{ label: string; remaining: number; resetMs?: number }>,
  viewWindows: ReadonlyArray<{ label: string; remaining: number }>,
  tierOf: (label: string, resetMs?: number) => "short" | "weekly" | "monthly",
): OffTabWorstCue | null {
  const viewMin = viewMinRemaining(viewWindows);
  if (viewMin === null || allWindows.length === 0) return null;

  let worst = allWindows[0]!;
  for (let i = 1; i < allWindows.length; i++) {
    const w = allWindows[i]!;
    if (w.remaining < worst.remaining) worst = w;
  }
  if (worst.remaining >= viewMin) return null;

  const viewLabels = new Set(viewWindows.map((w) => w.label));
  const candidate = viewLabels.has(worst.label)
    ? allWindows
        .filter((w) => !viewLabels.has(w.label))
        .reduce<(typeof allWindows)[number] | null>((best, w) => {
          if (best === null || w.remaining < best.remaining) return w;
          return best;
        }, null)
    : worst;
  if (candidate === null || candidate.remaining >= viewMin) return null;

  const tier = tierOf(candidate.label, candidate.resetMs);
  const horizonLabel = tier === "short" ? "Current" : tier === "weekly" ? "Weekly" : "Monthly";
  return {
    horizonLabel,
    remaining: candidate.remaining,
    windowLabel: candidate.label,
  };
}
