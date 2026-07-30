import type { JSX } from "react";
import { ControlsBar } from "../components/ControlsBar";
import { Dashboard } from "../components/Dashboard";
import { PaneShell } from "../components/PaneShell";
import { SummaryHeader } from "../components/SummaryHeader";
import { TrendPanel } from "../components/TrendPanel";
import { useStatusState } from "../lib/store";

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
      <SummaryHeader model={model} fetchedAt={fetchedAt} nextFetchAt={nextFetchAt} now={now} />

      <div className="mt-4">
        <ControlsBar />
      </div>

      <Dashboard />

      <TrendPanel />
    </PaneShell>
  );
}
