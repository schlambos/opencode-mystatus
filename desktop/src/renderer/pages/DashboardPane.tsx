import { useState, type JSX } from "react";
import { useStatusState } from "../lib/store";
import { hiddenNameSet, hiddenProviders, setProviderHidden } from "../lib/hiddenProviders";
import { resetCountdown, statusTone, toneTextClass } from "../lib/status";
import { windowsForView, type Horizon } from "../lib/tiers";
import type { MyStatusViewProvider, MyStatusViewWindow } from "../../shared/ipc";

type Tab = Horizon | "hidden";

const HORIZONS: ReadonlyArray<{ id: Horizon; label: string }> = [
  { id: "current", label: "Current" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const BAR_CELLS = 12;

const toneBarClass = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  low: "bg-status-low",
  dead: "bg-status-dead",
} as const;

function Bar({ pct, threshold }: { pct: number; threshold: number }): JSX.Element {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((pct / 100) * BAR_CELLS)));
  const tone = statusTone(pct, threshold);
  return (
    <div className="flex shrink-0 gap-[3px]" aria-hidden>
      {Array.from({ length: BAR_CELLS }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-[2px] ${i < filled ? toneBarClass[tone] : "bg-ink-700"}`}
        />
      ))}
    </div>
  );
}

function Row({
  provider,
  window: win,
  showLabel,
  threshold,
  fetchedAt,
  now,
}: {
  provider: MyStatusViewProvider;
  window: MyStatusViewWindow;
  showLabel: boolean;
  threshold: number;
  fetchedAt: number | null;
  now: number;
}): JSX.Element {
  const tone = statusTone(win.remaining, threshold);
  const reset = resetCountdown(win.resetMs, fetchedAt, now);

  return (
    <li
      data-testid="provider-row"
      data-provider-name={provider.name}
      className="group flex items-center gap-4 py-2.5"
    >
      <span className="w-44 shrink-0 truncate text-sm text-fog-100">
        {provider.name}
        {provider.stale && <span className="ml-2 text-xs text-status-warn">stale</span>}
      </span>
      <span className="w-32 shrink-0 truncate text-xs text-fog-500">
        {showLabel ? win.label : ""}
      </span>
      <Bar pct={win.remaining} threshold={threshold} />
      <span className={`w-12 text-right font-mono text-sm tabular-nums ${toneTextClass[tone]}`}>
        {win.remaining}%
      </span>
      <span className="w-20 text-right font-mono text-xs tabular-nums text-fog-500">
        {reset === null ? "" : reset.text}
      </span>
      <button
        type="button"
        title={`Hide ${provider.name}`}
        onClick={() => void setProviderHidden(provider.name, true)}
        className="ml-auto px-1 text-fog-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fog-200"
      >
        ×
      </button>
    </li>
  );
}

export function DashboardPane(): JSX.Element {
  const { model, config, fetchedAt, now, modelError } = useStatusState();
  const [tab, setTab] = useState<Tab>("current");

  if (model === null) {
    return <p className="px-6 py-8 text-sm text-fog-500">{modelError ?? "Loading…"}</p>;
  }

  const hidden = hiddenNameSet(config);
  const hiddenList = hiddenProviders(model.providers, hidden);
  const visible = model.providers.filter((p) => !hidden.has(p.name.toLowerCase()));

  const rows =
    tab === "hidden"
      ? []
      : visible
          .flatMap((provider) => {
            const wins = windowsForView(provider.windows, tab);
            return wins.map((w) => ({ provider, window: w, showLabel: wins.length > 1 }));
          })
          .sort((a, b) => a.window.remaining - b.window.remaining);

  return (
    <div className="px-6 py-4">
      <div className="mb-2 flex items-center gap-4 border-b border-ink-800 pb-2">
        {HORIZONS.map((h) => (
          <button
            key={h.id}
            type="button"
            data-testid={`tab-${h.id}`}
            onClick={() => setTab(h.id)}
            className={`text-xs ${tab === h.id ? "text-fog-100" : "text-fog-500 hover:text-fog-300"}`}
          >
            {h.label}
          </button>
        ))}
        {hiddenList.length > 0 && (
          <button
            type="button"
            data-testid="tab-hidden"
            onClick={() => setTab("hidden")}
            className={`ml-auto text-xs ${tab === "hidden" ? "text-fog-100" : "text-fog-500 hover:text-fog-300"}`}
          >
            Hidden ({hiddenList.length})
          </button>
        )}
      </div>

      {modelError !== null && (
        <p className="mb-2 text-xs text-status-low">Last sync failed — showing previous data.</p>
      )}

      {tab === "hidden" ? (
        <ul className="divide-y divide-ink-800">
          {hiddenList.map((p) => (
            <li key={p.name} className="flex items-center gap-4 py-2.5">
              <span className="w-44 shrink-0 truncate text-sm text-fog-400">{p.name}</span>
              <button
                type="button"
                onClick={() => void setProviderHidden(p.name, false)}
                className="text-xs text-fog-500 hover:text-fog-100"
              >
                Show
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-ink-800">
          {rows.map((r) => (
            <Row
              key={`${r.provider.name}::${r.window.label}`}
              provider={r.provider}
              window={r.window}
              showLabel={r.showLabel}
              threshold={model.threshold}
              fetchedAt={fetchedAt}
              now={now}
            />
          ))}
        </ul>
      )}

      {tab !== "hidden" && rows.length === 0 && (
        <p className="py-8 text-sm text-fog-500">
          No {tab} quotas. Add accounts with the Accounts button.
        </p>
      )}
    </div>
  );
}
