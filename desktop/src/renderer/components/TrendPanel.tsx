import { useEffect, useState, type JSX } from "react";
import type {
  HistorySnapshot,
  MyStatusViewModel,
  MyStatusViewProvider,
  MyStatusViewWindow,
  TrendMode,
} from "../../shared/ipc.js";
import { isHistoryResponse } from "../../shared/viewmodel.js";
import { getBridge } from "../lib/bridge";
import { buildSeriesMap, computeTrend, seriesKey } from "../lib/trend";
import { useStatusState } from "../lib/store";
import { ResetCountdown } from "./ResetCountdown";
import { TrendRow } from "./TrendRow";

function trendModeOf(configTrend: string | undefined): TrendMode {
  if (configTrend === "off" || configTrend === "compact" || configTrend === "full") {
    return configTrend;
  }
  // Core default (plugin/mystatus.ts:7275): compact.
  return "compact";
}

// History is re-read on connect and whenever a new view model lands (each
// completed poll may have recorded a snapshot). Read-only; failures keep the
// previous series rather than surfacing an error (trends are decorative).
function useTrendHistory(model: MyStatusViewModel | null): HistorySnapshot[] {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  useEffect(() => {
    const api = getBridge();
    if (!api) return;
    let cancelled = false;
    void api
      .getHistory()
      .then((res) => {
        if (!cancelled && isHistoryResponse(res)) setSnapshots(res.snapshots);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [model]);
  return snapshots;
}

interface WindowRowProps {
  provider: MyStatusViewProvider;
  window: MyStatusViewWindow;
  mode: TrendMode;
  history: HistorySnapshot[];
  delay: number;
}

function WindowRow({ provider, window: win, mode, history, delay }: WindowRowProps): JSX.Element {
  const { now } = useStatusState();
  const seriesMap = buildSeriesMap(history);
  const series = seriesMap.get(seriesKey(provider.name, win.label)) ?? [];
  const trend =
    mode === "off"
      ? null
      : computeTrend({ series, remaining: win.remaining, resetMs: win.resetMs, mode, nowMs: now });

  return (
    <div
      data-testid="trend-window-row"
      className="animate-rise flex items-center gap-4 px-4 py-2.5 transition-colors duration-150 hover:bg-ink-850"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="min-w-0 flex-1 truncate text-sm text-fog-200">{win.label}</span>
      {trend !== null ? (
        <TrendRow trend={trend} />
      ) : (
        <span className="font-mono text-[10px] tracking-wide text-fog-600">
          {mode === "off" ? "trend off" : "collecting\u2026"}
        </span>
      )}
      <ResetCountdown resetMs={win.resetMs} className="w-20 text-right" />
    </div>
  );
}

export function TrendPanel(): JSX.Element | null {
  const { model, config } = useStatusState();
  const history = useTrendHistory(model);
  if (model === null) return null;
  const mode = trendModeOf(config?.trend);
  let rowIndex = 0;

  return (
    <section data-testid="trend-panel" className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold text-fog-100">Usage trends</h2>
          <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-fog-400 uppercase">
            {mode}
          </span>
        </div>
        <span className="font-mono text-[10px] text-fog-500 tabular-nums">
          {history.length} snapshot{history.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
        {history.length === 0 ? (
          <p
            data-testid="trend-empty-hint"
            className="animate-rise px-4 py-3.5 text-sm text-fog-500"
          >
            Trends appear after the second sync — the first run records history but has nothing to
            compare against yet.
          </p>
        ) : (
          <div className="max-h-[420px] divide-y divide-ink-800 overflow-y-auto">
            {model.providers.map((provider) => (
              <div key={provider.name}>
                <p className="border-l-2 border-accent/60 bg-ink-850/60 px-4 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-fog-400 uppercase">
                  {provider.name}
                </p>
                {provider.windows.map((win) => (
                  <WindowRow
                    key={`${provider.name}/${win.label}`}
                    provider={provider}
                    window={win}
                    mode={mode}
                    history={history}
                    delay={Math.min(rowIndex++, 12) * 30}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
