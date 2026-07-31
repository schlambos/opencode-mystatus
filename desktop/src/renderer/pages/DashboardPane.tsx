import { useMemo, useState, type JSX } from "react";
import { useStatusState } from "../lib/store";
import { hiddenNameSet, hiddenProviders, setProviderHidden } from "../lib/hiddenProviders";
import {
  formatAge,
  offTabWorstCue,
  resetCountdown,
  statusTone,
  viewMinRemaining,
  type StatusTone,
} from "../lib/status";
import { windowTier, windowsForView, type Horizon } from "../lib/tiers";
import type { MyStatusViewProvider, MyStatusViewWindow } from "../../shared/ipc";

type ViewTab = Horizon | "all";
type Tab = ViewTab | "hidden";
type TierFilter = "all" | "ok" | "warn" | "low" | "dead";

const VIEW_TABS: ReadonlyArray<{ id: ViewTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "current", label: "Current" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

function windowsForTab(windows: MyStatusViewWindow[], tab: ViewTab): MyStatusViewWindow[] {
  if (tab === "all") {
    return [...windows].sort((a, b) => {
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return (a.resetMs ?? Infinity) - (b.resetMs ?? Infinity);
    });
  }
  return windowsForView(windows, tab);
}

const PER_PAGE = 12;

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

const barClass: Record<StatusTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  low: "bg-status-low",
  dead: "bg-status-dead",
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
  const pct = Math.max(0, Math.min(100, win.remaining));

  return (
    <li
      data-testid="quota-pill"
      className={`flex items-center gap-1.5 rounded-md border px-2 py-[4px] ${pillClass[tone]}`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fog-200" title={win.label}>
        {win.label}
      </span>
      <span
        className="relative h-1 w-9 shrink-0 overflow-hidden rounded-full bg-ink-700"
        aria-hidden
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${barClass[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`w-9 shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums ${pctClass[tone]}`}
      >
        {win.remaining}%
      </span>
      {reset !== null && (
        <span className="shrink-0 font-mono text-[10px] text-fog-500" aria-hidden>
          {reset.text}
        </span>
      )}
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
  const viewMin = viewMinRemaining(windows) ?? provider.minRemaining;
  const worst = statusTone(viewMin, threshold);
  const cue = offTabWorstCue(provider.windows, windows, windowTier);
  const staleHours =
    provider.stale !== undefined ? Math.max(0, Math.round(provider.stale.ageMs / 3600000)) : null;

  return (
    <section
      data-testid="provider-card"
      data-provider-name={provider.name}
      className="group flex flex-col rounded-xl border border-ink-800 bg-ink-900 p-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fog-100" title={provider.name}>
          {provider.name}
        </h2>
        {staleHours !== null && (
          <span
            className="shrink-0 rounded border border-status-warn/30 bg-status-warn/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-status-warn"
            title={provider.stale?.reason ?? "stale data"}
          >
            stale {staleHours}h
          </span>
        )}
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${pillClass[worst]} ${pctClass[worst]}`}
          aria-label={`${viewMin}% remaining`}
        >
          {viewMin}%
        </span>
        <button
          type="button"
          aria-label={`Hide ${provider.name}`}
          title={`Hide ${provider.name}`}
          onClick={() => void setProviderHidden(provider.name, true)}
          className={`shrink-0 rounded-md border border-ink-700 px-1.5 py-0.5 text-[10px] font-medium text-fog-500 opacity-70 transition-opacity hover:border-ink-600 hover:bg-ink-800 hover:text-fog-200 hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${focusRing}`}
        >
          Hide
        </button>
      </header>

      {cue !== null && (
        <p className="mb-1.5 font-mono text-[10px] text-fog-500" data-testid="off-tab-cue">
          <span className={pctClass[statusTone(cue.remaining, threshold)]}>{cue.remaining}%</span>
          {" · "}
          {cue.horizonLabel}
          <span className="text-fog-600"> · other tab</span>
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {windows.map((w) => (
          <Pill key={w.label} window={w} threshold={threshold} fetchedAt={fetchedAt} now={now} />
        ))}
      </ul>
    </section>
  );
}

export function DashboardPane(): JSX.Element {
  const { model, config, fetchedAt, now, modelError } = useStatusState();
  const [tab, setTab] = useState<Tab>("current");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const cards = useMemo(() => {
    if (model === null || tab === "hidden") return [];
    const hidden = hiddenNameSet(config);
    const view = tab as ViewTab;
    return model.providers
      .filter((p) => !hidden.has(p.name.toLowerCase()))
      .map((provider) => ({
        provider,
        windows: windowsForTab(provider.windows, view),
      }))
      .filter((c) => c.windows.length > 0)
      .sort((a, b) => {
        const aMin = viewMinRemaining(a.windows) ?? a.provider.minRemaining;
        const bMin = viewMinRemaining(b.windows) ?? b.provider.minRemaining;
        if (a.provider.minRemaining !== b.provider.minRemaining) {
          return a.provider.minRemaining - b.provider.minRemaining;
        }
        return aMin - bMin;
      });
  }, [model, config, tab]);

  const tierCounts = useMemo(() => {
    if (model === null) return { all: 0, ok: 0, warn: 0, low: 0, dead: 0 };
    const counts = { all: cards.length, ok: 0, warn: 0, low: 0, dead: 0 };
    for (const c of cards) {
      const vm = viewMinRemaining(c.windows) ?? c.provider.minRemaining;
      counts[statusTone(vm, model.threshold)] += 1;
    }
    return counts;
  }, [cards, model]);

  const filtered = useMemo(() => {
    if (model === null) return [];
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      const vm = viewMinRemaining(c.windows) ?? c.provider.minRemaining;
      if (tierFilter !== "all" && statusTone(vm, model.threshold) !== tierFilter) return false;
      if (q !== "" && !c.provider.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, tierFilter, query, model]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageIdx = Math.min(page, pageCount - 1);
  const pageCards = filtered.slice(pageIdx * PER_PAGE, (pageIdx + 1) * PER_PAGE);
  const multiPage = pageCount > 1;

  if (model === null) {
    return <p className="px-6 py-8 text-sm text-fog-500">{modelError ?? "Loading…"}</p>;
  }

  const hiddenList = hiddenProviders(model.providers, hiddenNameSet(config));
  const { summary } = model;
  const ageSec =
    fetchedAt === null ? null : Math.max(0, Math.floor((now - fetchedAt) / 1000));

  function selectTab(next: Tab): void {
    setTab(next);
    setPage(0);
  }
  function selectTier(next: TierFilter): void {
    setTierFilter(next);
    setPage(0);
  }
  function onSearch(next: string): void {
    setQuery(next);
    setPage(0);
  }

  const tierChip = (id: TierFilter, label: string, count: number): JSX.Element => (
    <button
      key={id}
      type="button"
      data-testid={`tier-${id}`}
      aria-pressed={tierFilter === id}
      onClick={() => selectTier(id)}
      className={`rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide transition-colors ${focusRing} ${
        tierFilter === id ? "bg-ink-700 text-fog-100" : "text-fog-500 hover:text-fog-200"
      }`}
    >
      {label} <span className="font-mono text-[10px] text-fog-600">{count}</span>
    </button>
  );

  return (
    <div className="flex h-full flex-col px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 text-fog-500"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            aria-label="Search providers"
            className={`w-32 bg-transparent text-xs text-fog-100 placeholder:text-fog-600 focus:outline-none ${focusRing} rounded-sm`}
          />
        </div>

        <div
          className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5"
          role="group"
          aria-label="Horizon"
        >
          {VIEW_TABS.map((h) => (
            <button
              key={h.id}
              type="button"
              data-testid={`tab-${h.id}`}
              aria-pressed={tab === h.id}
              onClick={() => selectTab(h.id)}
              className={`rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${focusRing} ${
                tab === h.id ? "bg-ink-700 text-fog-100" : "text-fog-500 hover:text-fog-200"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        <div
          className="inline-flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900 p-0.5"
          role="group"
          aria-label="Tier filter"
        >
          {tierChip("all", "ALL", tierCounts.all)}
          {tierChip("ok", "OK", tierCounts.ok)}
          {tierChip("warn", "WATCH", tierCounts.warn)}
          {tierChip("low", "LOW", tierCounts.low)}
          {tierChip("dead", "EMPTY", tierCounts.dead)}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {hiddenList.length > 0 && (
            <button
              type="button"
              data-testid="tab-hidden"
              aria-pressed={tab === "hidden"}
              onClick={() => selectTab("hidden")}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${focusRing} ${
                tab === "hidden"
                  ? "border-ink-600 bg-ink-800 text-fog-100"
                  : "border-ink-700 bg-ink-900 text-fog-500 hover:text-fog-200"
              }`}
            >
              Hidden {hiddenList.length}
            </button>
          )}
        </div>
      </div>

      {tab !== "hidden" && (
        <p
          className="mb-2 font-mono text-[11px] text-fog-500"
          data-testid="micro-summary"
          aria-live="polite"
        >
          {summary.accounts} accounts
          <span className="text-fog-600"> · </span>
          <span className="text-status-ok">{summary.green} ok</span>
          <span className="text-fog-600"> · </span>
          <span className="text-status-warn">{summary.yellow} watch</span>
          <span className="text-fog-600"> · </span>
          <span className="text-status-low">{summary.red} low</span>
          {summary.lowest !== undefined && (
            <>
              <span className="text-fog-600"> · </span>
              lowest {summary.lowest.provider} {summary.lowest.remaining}%
            </>
          )}
          {ageSec !== null && (
            <>
              <span className="text-fog-600"> · </span>
              {formatAge(ageSec)} ago
            </>
          )}
        </p>
      )}

      {modelError !== null && (
        <p className="mb-2 text-xs text-status-low">Last sync failed — showing previous data.</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "hidden" ? (
          <ul className="flex flex-col gap-1.5">
            {hiddenList.map((p) => (
              <li
                key={p.name}
                className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-fog-400">{p.name}</span>
                <button
                  type="button"
                  onClick={() => void setProviderHidden(p.name, false)}
                  className={`min-h-7 rounded-md px-2 text-xs text-fog-500 hover:bg-ink-800 hover:text-fog-100 ${focusRing}`}
                >
                  Show
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {pageCards.map((c) => (
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

        {tab !== "hidden" && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-fog-500">
            No providers match. Adjust the search or filters.
          </p>
        )}
      </div>

      {tab !== "hidden" && filtered.length > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-ink-800 pt-2">
          <p className="text-[11px] text-fog-600">
            {multiPage
              ? `Showing ${pageIdx * PER_PAGE + 1}–${Math.min((pageIdx + 1) * PER_PAGE, filtered.length)} of ${filtered.length}`
              : `${filtered.length} provider${filtered.length === 1 ? "" : "s"}`}
          </p>
          {multiPage && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={pageIdx === 0}
                onClick={() => setPage(pageIdx - 1)}
                className={`min-h-8 min-w-8 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-400 transition-colors hover:text-fog-100 disabled:opacity-40 ${focusRing}`}
              >
                ‹
              </button>
              <span className="rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-950">
                {pageIdx + 1}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={pageIdx >= pageCount - 1}
                onClick={() => setPage(pageIdx + 1)}
                className={`min-h-8 min-w-8 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-400 transition-colors hover:text-fog-100 disabled:opacity-40 ${focusRing}`}
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
