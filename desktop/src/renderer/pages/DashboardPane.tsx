import type { JSX, ReactNode } from "react";
import { PaneShell } from "../components/PaneShell";
import { formatAge, formatDuration, resetCountdown, toneDotClass } from "../lib/status";
import { useStatusState } from "../lib/store";

interface StatChipProps {
  label: string;
  delay: number;
  children: ReactNode;
}

function StatChip({ label, delay, children }: StatChipProps): JSX.Element {
  return (
    <div
      className="animate-rise rounded-lg border border-ink-700 bg-gradient-to-b from-ink-850 to-ink-900 px-4 py-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">{label}</p>
      <div className="mt-1.5 font-mono text-lg font-semibold text-fog-100 tabular-nums">
        {children}
      </div>
    </div>
  );
}

export function DashboardPane(): JSX.Element {
  const { model, fetchedAt, nextFetchAt, now, payloadError, modelError } = useStatusState();

  if (payloadError !== null) {
    return (
      <PaneShell testId="pane-dashboard" kicker="Overview" title="Dashboard">
        <div
          role="alert"
          data-testid="payload-error"
          className="animate-rise max-w-2xl rounded-lg border border-status-low/40 bg-status-low/10 p-5"
        >
          <p className="text-[10px] font-semibold tracking-[0.2em] text-status-low uppercase">
            Malformed status payload
          </p>
          <p className="mt-2 text-sm text-fog-200">
            The main process pushed a payload this shell cannot use:{" "}
            <code className="rounded bg-ink-950/80 px-1.5 py-0.5 font-mono text-xs text-status-low">
              {payloadError}
            </code>
          </p>
          <p className="mt-2 text-sm text-fog-400">
            Previously received data stays on screen. The panel clears itself on the next healthy
            sync.
          </p>
        </div>
      </PaneShell>
    );
  }

  if (model === null || fetchedAt === null || nextFetchAt === null) {
    return (
      <PaneShell testId="pane-dashboard" kicker="Overview" title="Dashboard">
        {modelError !== null ? (
          <div
            role="alert"
            data-testid="model-error"
            className="animate-rise max-w-2xl rounded-lg border border-status-dead/40 bg-status-dead/10 p-5"
          >
            <p className="text-[10px] font-semibold tracking-[0.2em] text-status-dead uppercase">
              First sync failed
            </p>
            <p className="mt-2 font-mono text-sm text-fog-200">{modelError}</p>
            <p className="mt-2 text-sm text-fog-400">The shell retries on the next poll cycle.</p>
          </div>
        ) : (
          <div
            data-testid="awaiting-sync"
            className="animate-rise flex max-w-2xl items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 p-5"
          >
            <span className="h-2 w-2 rounded-full bg-status-warn animate-blink" aria-hidden />
            <div>
              <p className="text-sm font-medium text-fog-200">Waiting for the first sync…</p>
              <p className="mt-0.5 text-xs text-fog-500">
                The main-process poller pushes view models over IPC; this pane lights up on the
                first payload.
              </p>
            </div>
          </div>
        )}
      </PaneShell>
    );
  }

  const { summary } = model;
  const ageText = formatAge(Math.max(0, Math.floor((now - fetchedAt) / 1000)));
  const nextText = formatDuration(Math.max(0, Math.floor((nextFetchAt - now) / 1000)));
  const soonest =
    summary.soonest !== undefined
      ? resetCountdown(summary.soonest.resetMs, fetchedAt, now)
      : null;

  return (
    <PaneShell testId="pane-dashboard" kicker="Overview" title="Dashboard">
      {modelError !== null && (
        <div
          role="alert"
          data-testid="model-error-strip"
          className="animate-rise mb-4 rounded-lg border border-status-low/40 bg-status-low/10 px-4 py-2.5 text-sm text-fog-200"
        >
          Last query failed — showing previous data.{" "}
          <span className="font-mono text-xs text-status-low">{modelError}</span>
        </div>
      )}
      <div data-testid="dashboard-overview" className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatChip label="Providers" delay={0}>
          <span data-testid="provider-count">{model.providers.length} providers</span>
        </StatChip>
        <StatChip label="Accounts" delay={40}>
          {summary.accounts}
        </StatChip>
        <StatChip label="Reporting" delay={80}>
          {model.health.rendered}/{model.health.queried}
        </StatChip>
        <StatChip label="Tally" delay={120}>
          <span className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${toneDotClass["ok"]}`} />
              {summary.green}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${toneDotClass["warn"]}`} />
              {summary.yellow}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${toneDotClass["dead"]}`} />
              {summary.red}
            </span>
          </span>
        </StatChip>
        <StatChip label="Synced" delay={160}>
          {ageText} ago
        </StatChip>
        <StatChip label="Next sync" delay={200}>
          in {nextText}
        </StatChip>
      </div>

      <div
        className="animate-rise mt-4 flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3"
        style={{ animationDelay: "240ms" }}
      >
        <span className="text-fog-500" aria-hidden>
          ↻
        </span>
        {summary.soonest !== undefined && soonest !== null ? (
          <p className="text-sm text-fog-200">
            Soonest reset{" "}
            <span className="text-fog-400">
              {summary.soonest.provider} · {summary.soonest.label}
            </span>{" "}
            <span data-testid="soonest-countdown" className="font-mono text-fog-100 tabular-nums">
              {soonest.text}
            </span>
          </p>
        ) : (
          <p className="text-sm text-fog-400">No upcoming resets reported.</p>
        )}
      </div>

      <p
        className="animate-rise mt-8 border-l-2 border-ink-700 pl-4 text-sm text-fog-500"
        style={{ animationDelay: "300ms" }}
      >
        Shell view — the full card grid (summary header, horizon tabs, meters, trends) lands in
        wave 2. Data below arrives live from the main-process poller.
      </p>
    </PaneShell>
  );
}
