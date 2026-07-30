// Summary header card — renders MyStatusViewModel.summary verbatim (the core
// computes accounts/green/yellow/red/lowest/soonest in buildMyStatusViewModel,
// plugin/mystatus.ts:7336-7405) plus model.health, the sync cadence from the
// store, and a manual refresh. No summary math is re-derived here: tallies map
// 1:1 onto the existing status-tier tokens, and the soonest countdown uses the
// same resetMs - (now - fetchedAt) math as the TUI (lib/status.ts).
//
// Health row parity: plugin/tui.ts:608-626 — statusText ("{age} ago", "sync Ns")
// and attentionFlags (failed → stale → unconfigured, each shown only when > 0).

import { useState, type JSX } from "react";
import type { MyStatusViewModel } from "../../shared/ipc";
import { ExportMenu } from "./ExportMenu";
import { getBridge } from "../lib/bridge";
import {
  formatAge,
  resetCountdown,
  statusTone,
  toneDotClass,
  toneTextClass,
  type StatusTone,
} from "../lib/status";

interface SummaryHeaderProps {
  model: MyStatusViewModel;
  fetchedAt: number;
  nextFetchAt: number;
  /** Store ticker wall clock — advances once per second while mounted. */
  now: number;
}

const TALLIES: ReadonlyArray<{ key: "green" | "yellow" | "red"; tone: StatusTone; label: string }> = [
  { key: "green", tone: "ok", label: "healthy" },
  { key: "yellow", tone: "warn", label: "watch" },
  { key: "red", tone: "dead", label: "critical" },
];

// Full literal class names (no interpolation) so Tailwind's scanner sees them.
const EDGE_ACCENT: Record<StatusTone | "flat", string> = {
  ok: "border-l-status-ok",
  warn: "border-l-status-warn",
  low: "border-l-status-low",
  dead: "border-l-status-dead",
  flat: "border-l-ink-600",
};

function edgeTone(summary: MyStatusViewModel["summary"]): StatusTone | "flat" {
  if (summary.red > 0) return "dead";
  if (summary.yellow > 0) return "warn";
  if (summary.green > 0) return "ok";
  return "flat";
}

export function SummaryHeader({ model, fetchedAt, nextFetchAt, now }: SummaryHeaderProps): JSX.Element {
  const [refreshing, setRefreshing] = useState(false);
  const { summary, health, threshold } = model;

  const ageText = formatAge(Math.max(0, Math.floor((now - fetchedAt) / 1000)));
  const nextSec = Math.max(0, Math.round((nextFetchAt - now) / 1000));
  const soonestCountdown =
    summary.soonest !== undefined ? resetCountdown(summary.soonest.resetMs, fetchedAt, now) : null;
  const showHealth = health.failed > 0 || health.stale > 0 || health.unconfigured > 0;

  function handleRefresh(): void {
    if (refreshing) return;
    const api = getBridge();
    if (!api) return; // preload absent — degrade, same as connectStatusStore
    setRefreshing(true);
    // refresh() resolves only after the forced fetch broadcasts (poller.ts),
    // so the spinner tracks the real sync, not a UI flash.
    void api.refresh().finally(() => setRefreshing(false));
  }

  return (
    <header
      data-testid="summary-header"
      className={`animate-rise rounded-lg border border-ink-700 border-l-2 ${EDGE_ACCENT[edgeTone(summary)]} bg-gradient-to-b from-ink-850 to-ink-900`}
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
        <div className="flex items-center gap-5">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">Accounts</p>
            <p
              data-testid="summary-accounts"
              className="mt-0.5 font-mono text-3xl font-semibold text-fog-100 tabular-nums"
            >
              {summary.accounts}
            </p>
          </div>
          <div className="h-10 w-px bg-ink-700" aria-hidden />
          <ul data-testid="summary-tally" className="flex flex-col gap-1.5">
            {TALLIES.map((tally) => (
              <li key={tally.key} title={tally.label} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${toneDotClass[tally.tone]}`} aria-hidden />
                <span className="w-5 font-mono text-xs font-semibold text-fog-200 tabular-nums">
                  {summary[tally.key]}
                </span>
                <span className="text-[10px] font-medium tracking-[0.14em] text-fog-500 uppercase">
                  {tally.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-baseline gap-3">
            <span className="w-24 shrink-0 text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">
              Lowest
            </span>
            {summary.lowest !== undefined ? (
              <p data-testid="summary-lowest" className="min-w-0 truncate text-sm text-fog-200">
                {summary.lowest.provider} · {summary.lowest.label}{" "}
                <span
                  className={`font-mono font-semibold tabular-nums ${toneTextClass[statusTone(summary.lowest.remaining, threshold)]}`}
                >
                  {summary.lowest.remaining}%
                </span>
              </p>
            ) : (
              <p data-testid="summary-lowest" className="text-sm text-fog-500">
                No windows reported.
              </p>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="w-24 shrink-0 text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">
              Soonest reset
            </span>
            {summary.soonest !== undefined && soonestCountdown !== null ? (
              <p data-testid="summary-soonest" className="min-w-0 truncate text-sm text-fog-200">
                {summary.soonest.provider} · {summary.soonest.label}{" "}
                <span
                  data-testid="soonest-countdown"
                  className={`font-mono font-semibold text-fog-100 tabular-nums ${soonestCountdown.leftMs === 0 ? "animate-blink text-status-warn" : ""}`}
                >
                  {soonestCountdown.text}
                </span>
              </p>
            ) : (
              <p data-testid="summary-soonest" className="text-sm text-fog-500">
                No upcoming resets reported.
              </p>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <p
            data-testid="summary-sync"
            className="text-right font-mono text-xs leading-relaxed text-fog-500 tabular-nums"
          >
            last synced {ageText} ago
            <br />
            next sync in {nextSec}s
          </p>
          <ExportMenu args={() => ({ threshold: model.threshold })} />
          <button
            type="button"
            data-testid="summary-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh now"
            className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ink-700 bg-ink-900 text-fog-400 transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 ${refreshing ? "animate-spin" : "transition-transform duration-500 group-hover:rotate-180"}`}
              aria-hidden
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        </div>
      </div>

      {showHealth && (
        <div
          data-testid="summary-health"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-ink-700/70 px-5 py-2.5 font-mono text-xs tabular-nums"
        >
          <span className="text-fog-400">
            {health.rendered}/{health.queried} reporting
          </span>
          {health.failed > 0 && <span className="font-medium text-status-dead">· {health.failed} failed</span>}
          {health.stale > 0 && <span className="font-medium text-status-warn">· {health.stale} stale</span>}
          {health.unconfigured > 0 && <span className="text-fog-500">· {health.unconfigured} not configured</span>}
        </div>
      )}
    </header>
  );
}
