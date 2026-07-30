import { useEffect, type JSX } from "react";
import type { TrendMode } from "../../shared/ipc.js";
import {
  bucketTallies,
  controlsBaselines,
  isControlsDirty,
  SORT_MODES,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  THRESHOLD_STEP,
  TREND_MODES,
  type SortMode,
} from "../lib/controls";
import { toneDotClass } from "../lib/status";
import {
  clearControlsNotice,
  saveControlsAsDefaults,
  setSortMode,
  setThreshold,
  setTrendMode,
  useStatusState,
} from "../lib/store";

interface SegmentedProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  testPrefix: string;
}

function Segmented<T extends string>({ label, options, value, onChange, testPrefix }: SegmentedProps<T>): JSX.Element {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">{label}</p>
      <div role="group" aria-label={label} className="mt-1.5 inline-flex rounded-md border border-ink-700 bg-ink-950/70 p-0.5">
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              data-testid={`${testPrefix}-${option}`}
              aria-pressed={active}
              onClick={() => onChange(option)}
              className={`rounded-[5px] px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none ${
                active
                  ? "bg-ink-700 text-fog-100 shadow-sm"
                  : "text-fog-500 hover:bg-ink-800 hover:text-fog-200"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ControlsBar(): JSX.Element {
  const state = useStatusState();
  const { controls, config, prefs, model, controlsSaving, controlsNotice } = state;
  const dirty = isControlsDirty(controls, controlsBaselines(config, prefs));
  const tallies = model === null ? null : bucketTallies(model.providers, controls.threshold);

  useEffect(() => {
    if (controlsNotice === null) return;
    const timer = setTimeout(() => clearControlsNotice(), 4000);
    return () => clearTimeout(timer);
  }, [controlsNotice]);

  return (
    <section
      data-testid="controls-bar"
      aria-label="Display controls"
      className="animate-rise rounded-lg border border-ink-700 bg-gradient-to-b from-ink-850 to-ink-900 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Segmented<SortMode>
          label="Sort"
          options={SORT_MODES}
          value={controls.sortMode}
          onChange={setSortMode}
          testPrefix="sort"
        />

        <div className="min-w-56">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">
              Low mark
            </p>
            <p
              data-testid="threshold-value"
              className="font-mono text-xs font-semibold text-status-low tabular-nums"
            >
              &lt; {controls.threshold}%
            </p>
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="font-mono text-[10px] text-fog-600 tabular-nums">{THRESHOLD_MIN}</span>
            <input
              type="range"
              data-testid="threshold-slider"
              aria-label="Low-quota threshold"
              className="threshold-slider w-40"
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={THRESHOLD_STEP}
              value={controls.threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <span className="font-mono text-[10px] text-fog-600 tabular-nums">{THRESHOLD_MAX}</span>
            <div className="ml-2 flex items-center gap-2.5 text-xs" aria-live="polite">
              {tallies === null ? (
                <span className="text-fog-600">—</span>
              ) : (
                (
                  [
                    ["green", "ok", tallies.green],
                    ["yellow", "warn", tallies.yellow],
                    ["red", "dead", tallies.red],
                  ] as const
                ).map(([tone, dotTone, count]) => (
                  <span
                    key={tone}
                    data-testid={`tally-${tone}`}
                    className="flex items-center gap-1 font-mono tabular-nums"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${toneDotClass[dotTone]}`} />
                    {count}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <Segmented<TrendMode>
          label="Trend"
          options={TREND_MODES}
          value={controls.trendMode}
          onChange={setTrendMode}
          testPrefix="trend"
        />

        <div className="ml-auto flex items-center gap-3">
          <p
            role="status"
            data-testid="controls-notice"
            className={`text-xs transition-opacity duration-300 ${
              controlsNotice === null
                ? "opacity-0"
                : controlsNotice.kind === "error"
                  ? "text-status-low"
                  : "text-status-ok"
            }`}
          >
            {controlsNotice?.text ?? ""}
          </p>
          <button
            type="button"
            data-testid="save-defaults"
            disabled={!dirty || controlsSaving}
            onClick={() => {
              void saveControlsAsDefaults();
            }}
            className="relative rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-all duration-150 hover:-translate-y-px hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dirty && !controlsSaving && (
              <span
                className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-status-warn"
                aria-hidden
              />
            )}
            {controlsSaving ? "Saving…" : "Save as defaults"}
          </button>
        </div>
      </div>
      <p className="mt-2.5 text-[11px] text-fog-600">
        Session changes apply instantly · saving writes sort/trend to{" "}
        <code className="font-mono text-fog-500">mystatus.json</code> and the low mark to{" "}
        <code className="font-mono text-fog-500">mystatus-desktop.json</code>
      </p>
    </section>
  );
}
