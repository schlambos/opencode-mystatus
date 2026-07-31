import { useState, type JSX } from "react";
import { useStatusState } from "../lib/store";
import { hiddenNameSet, hiddenProviders, setProviderHidden } from "../lib/hiddenProviders";
import { resetCountdown, statusTone, type StatusTone } from "../lib/status";
import { windowsForView, type Horizon } from "../lib/tiers";
import type { MyStatusViewProvider, MyStatusViewWindow } from "../../shared/ipc";

type Tab = Horizon | "all" | "hidden";

const TABS: ReadonlyArray<{ id: Horizon | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "current", label: "Current" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

// Full literal class strings so Tailwind's scanner keeps them.
const pillClass: Record<StatusTone, string> = {
  ok: "bg-status-ok/8 border-status-ok/20",
  warn: "bg-status-warn/8 border-status-warn/20",
  low: "bg-status-low/10 border-status-low/25",
  dead: "bg-status-dead/10 border-status-dead/25",
};

const pctClass: Record<StatusTone, string> = {
  ok: "text-status-ok",
  warn: "text-status-warn",
  low: "text-status-low",
  dead: "text-status-dead",
};

const dotClass: Record<StatusTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  low: "bg-status-low",
  dead: "bg-status-dead",
};

function Pill({
  window: win,
  threshold,
  fetchedAt,
  now,
}: {
  window: MyStatusViewWindow;
  threshold: number;
  fetchedAt: number | null;
  now: number;
}): JSX.Element {
  const tone = statusTone(win.remaining, threshold);
  const reset = resetCountdown(win.resetMs, fetchedAt, now);

  return (
    <li
      data-testid="quota-pill"
      className={`flex items-center gap-2 rounded-md border px-2 py-[5px] ${pillClass[tone]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[tone]}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fog-200" title={win.label}>
        {win.label}
      </span>
      {reset !== null && (
        <span className="shrink-0 font-mono text-[11px] text-status-warn">{reset.text}</span>
      )}
      <span className={`w-9 shrink-0 text-right font-mono text-[11px] ${pctClass[tone]}`}>
        {win.remaining}%
      </span>
    </li>
  );
}

function ProviderCard({
  provider,
  windows,
  threshold,
  fetchedAt,
  now,
}: {
  provider: MyStatusViewProvider;
  windows: MyStatusViewWindow[];
  threshold: number;
  fetchedAt: number | null;
  now: number;
}): JSX.Element {
  const worst = statusTone(provider.minRemaining, threshold);

  return (
    <section
      data-testid="provider-card"
      data-provider-name={provider.name}
      className="group flex flex-col self-start rounded-lg border border-ink-800 bg-ink-900 p-2.5"
    >
      <header className="mb-1.5 flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass[worst]}`} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fog-100" title={provider.name}>
          {provider.name}
        </h2>
        {provider.stale && (
          <span className="shrink-0 rounded bg-status-warn/10 px-1.5 py-0.5 text-[10px] text-status-warn">
            stale
          </span>
        )}
        <button
          type="button"
          title={`Hide ${provider.name}`}
          onClick={() => void setProviderHidden(provider.name, true)}
          className="shrink-0 px-1 text-fog-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fog-200"
        >
          ×
        </button>
      </header>

      <ul className="flex flex-col gap-[3px]">
        {windows.map((w) => (
          <Pill key={w.label} window={w} threshold={threshold} fetchedAt={fetchedAt} now={now} />
        ))}
      </ul>
    </section>
  );
}

export function DashboardPane(): JSX.Element {
  const { model, config, fetchedAt, now, modelError } = useStatusState();
  const [tab, setTab] = useState<Tab>("all");

  if (model === null) {
    return <p className="px-6 py-8 text-sm text-fog-500">{modelError ?? "Loading…"}</p>;
  }

  const hidden = hiddenNameSet(config);
  const hiddenList = hiddenProviders(model.providers, hidden);
  const visible = model.providers.filter((p) => !hidden.has(p.name.toLowerCase()));

  const cards =
    tab === "hidden"
      ? []
      : visible
          .map((provider) => ({
            provider,
            windows: tab === "all" ? provider.windows : windowsForView(provider.windows, tab),
          }))
          .filter((c) => c.windows.length > 0)
          .sort((a, b) => a.provider.minRemaining - b.provider.minRemaining);

  return (
    <div className="px-6 py-4">
      <div className="mb-4 flex items-center gap-4">
        {TABS.map((h) => (
          <button
            key={h.id}
            type="button"
            data-testid={`tab-${h.id}`}
            onClick={() => setTab(h.id)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              tab === h.id ? "bg-ink-750 text-fog-100" : "text-fog-500 hover:text-fog-200"
            }`}
          >
            {h.label}
          </button>
        ))}
        {hiddenList.length > 0 && (
          <button
            type="button"
            data-testid="tab-hidden"
            onClick={() => setTab("hidden")}
            className={`ml-auto rounded-full px-3 py-1 text-xs transition-colors ${
              tab === "hidden" ? "bg-ink-750 text-fog-100" : "text-fog-500 hover:text-fog-200"
            }`}
          >
            Hidden {hiddenList.length}
          </button>
        )}
      </div>

      {modelError !== null && (
        <p className="mb-3 text-xs text-status-low">Last sync failed — showing previous data.</p>
      )}

      {tab === "hidden" ? (
        <ul className="flex flex-col gap-1">
          {hiddenList.map((p) => (
            <li
              key={p.name}
              className="flex items-center gap-3 rounded-md border border-ink-800 bg-ink-900 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-fog-400">{p.name}</span>
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
        <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {cards.map((c) => (
            <ProviderCard
              key={c.provider.name}
              provider={c.provider}
              windows={c.windows}
              threshold={model.threshold}
              fetchedAt={fetchedAt}
              now={now}
            />
          ))}
        </div>
      )}

      {tab !== "hidden" && cards.length === 0 && (
        <p className="py-8 text-sm text-fog-500">
          No {tab} quotas. Add accounts with the Accounts button.
        </p>
      )}
    </div>
  );
}
