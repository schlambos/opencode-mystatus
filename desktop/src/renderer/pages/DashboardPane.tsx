import { useMemo, useState, type JSX } from "react";
import { useStatusState } from "../lib/store";
import { hiddenNameSet, hiddenProviders, setProviderHidden } from "../lib/hiddenProviders";
import { resetCountdown, statusTone, type StatusTone } from "../lib/status";
import { windowsForView, type Horizon } from "../lib/tiers";
import type { MyStatusViewProvider, MyStatusViewWindow } from "../../shared/ipc";

type Tab = Horizon | "hidden";
type TierFilter = "all" | "ok" | "warn" | "low" | "dead";

const HORIZONS: ReadonlyArray<{ id: Horizon; label: string }> = [
  { id: "current", label: "Current" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

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

const FOOTER_ACTIONS: ReadonlyArray<{ key: string; title: string; icon: JSX.Element }> = [
  {
    key: "info",
    title: "Details",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  },
  {
    key: "eye",
    title: "Watch",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    key: "tag",
    title: "Plan",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
        <path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4L12 2Z" />
        <circle cx="7" cy="7" r="1" />
      </svg>
    ),
  },
  {
    key: "refresh",
    title: "Refresh this provider",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    ),
  },
];

function FooterIcon({
  title,
  onClick,
  icon,
}: {
  title: string;
  onClick?: (() => void) | undefined;
  icon: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded p-1 text-fog-600 transition-colors hover:bg-ink-800 hover:text-fog-200"
    >
      {icon}
    </button>
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
      className="group flex flex-col rounded-xl border border-ink-800 bg-ink-900 p-3"
    >
      <header className="mb-2.5 flex items-center gap-2">
        <input
          type="checkbox"
          aria-label={`Select ${provider.name}`}
          className="h-3.5 w-3.5 shrink-0 rounded border-ink-600 bg-ink-800 accent-accent"
        />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fog-100" title={provider.name}>
          {provider.name}
        </h2>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider uppercase ${pillClass[worst]} ${pctClass[worst]}`}>
          {provider.minRemaining}%
        </span>
        <button
          type="button"
          title={`Hide ${provider.name}`}
          onClick={() => void setProviderHidden(provider.name, true)}
          className="shrink-0 px-0.5 text-fog-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fog-200"
        >
          ×
        </button>
      </header>

      {windows.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {windows.map((w) => (
            <Pill key={w.label} window={w} threshold={threshold} fetchedAt={fetchedAt} now={now} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-ink-800 px-2 py-2 font-mono text-[11px] text-fog-600">
          No windows in this view — every quota for this provider is in another horizon.
        </p>
      )}

      <footer className="mt-2.5 flex items-center gap-0.5 border-t border-ink-800 pt-2">
        {FOOTER_ACTIONS.map((a) => (
          <FooterIcon
            key={a.key}
            title={a.title}
            icon={a.icon}
            onClick={a.key === "refresh" ? () => void window.mystatus?.refresh?.() : undefined}
          />
        ))}
        <span className="ml-auto font-mono text-[10px] text-fog-600">
          {provider.stale ? `stale ${Math.round(provider.stale.ageMs / 3600000)}h` : ""}
        </span>
        <button
          type="button"
          title={`Hide ${provider.name}`}
          onClick={() => void setProviderHidden(provider.name, true)}
          className="rounded p-1 text-fog-600 transition-colors hover:bg-ink-800 hover:text-status-low"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </footer>
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
    if (model === null) return [];
    const hidden = hiddenNameSet(config);
    return model.providers
      .filter((p) => !hidden.has(p.name.toLowerCase()))
      .map((provider) => ({
        provider,
        windows: windowsForView(provider.windows, tab as Horizon),
      }))
      .sort((a, b) => a.provider.minRemaining - b.provider.minRemaining);
  }, [model, config, tab]);

  const tierCounts = useMemo(() => {
    if (model === null) return { all: 0, ok: 0, warn: 0, low: 0, dead: 0 };
    const counts = { all: cards.length, ok: 0, warn: 0, low: 0, dead: 0 };
    for (const c of cards) counts[statusTone(c.provider.minRemaining, model.threshold)] += 1;
    return counts;
  }, [cards, model]);

  const filtered = useMemo(() => {
    if (model === null) return [];
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (tierFilter !== "all" && statusTone(c.provider.minRemaining, model.threshold) !== tierFilter) return false;
      if (q !== "" && !c.provider.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, tierFilter, query, model]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageIdx = Math.min(page, pageCount - 1);
  const pageCards = filtered.slice(pageIdx * PER_PAGE, (pageIdx + 1) * PER_PAGE);

  if (model === null) {
    return <p className="px-6 py-8 text-sm text-fog-500">{modelError ?? "Loading…"}</p>;
  }

  const hiddenList = hiddenProviders(model.providers, hiddenNameSet(config));

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
      onClick={() => selectTier(id)}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors ${
        tierFilter === id ? "bg-ink-700 text-fog-100" : "text-fog-500 hover:text-fog-200"
      }`}
    >
      {label} <span className="font-mono text-[10px] text-fog-600">{count}</span>
    </button>
  );

  return (
    <div className="flex h-full flex-col px-4 py-3">
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-fog-500" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search provider…"
            aria-label="Search providers"
            className="w-40 bg-transparent text-xs text-fog-100 placeholder:text-fog-600 focus:outline-none"
          />
        </div>

        <div className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5" role="group" aria-label="Horizon">
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              type="button"
              data-testid={`tab-${h.id}`}
              aria-pressed={tab === h.id}
              onClick={() => selectTab(h.id)}
              className={`rounded-[6px] px-3 py-1 text-[11px] font-semibold transition-colors ${
                tab === h.id ? "bg-ink-700 text-fog-100" : "text-fog-500 hover:text-fog-200"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900 p-0.5" role="group" aria-label="Tier filter">
          {tierChip("all", "ALL", tierCounts.all)}
          {tierChip("ok", "OK", tierCounts.ok)}
          {tierChip("warn", "WATCH", tierCounts.warn)}
          {tierChip("low", "LOW", tierCounts.low)}
          {tierChip("dead", "EMPTY", tierCounts.dead)}
        </div>

        <button
          type="button"
          onClick={() => void window.mystatus?.refresh?.()}
          className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-ink-950 transition-colors hover:bg-accent/90"
        >
          Refresh All
        </button>

        <div className="ml-auto flex items-center gap-1">
          {hiddenList.length > 0 && (
            <button
              type="button"
              data-testid="tab-hidden"
              onClick={() => selectTab("hidden")}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
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

      {modelError !== null && (
        <p className="mb-2 text-xs text-status-low">Last sync failed — showing previous data.</p>
      )}

      {/* content */}
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
                  className="text-xs text-fog-500 hover:text-fog-100"
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

      {/* pagination footer */}
      {tab !== "hidden" && filtered.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-ink-800 pt-2.5">
          <p className="text-[11px] text-fog-600">
            Showing {pageIdx * PER_PAGE + 1} to {Math.min((pageIdx + 1) * PER_PAGE, filtered.length)} of{" "}
            {filtered.length} entries
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={pageIdx === 0}
              onClick={() => setPage(pageIdx - 1)}
              className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-400 transition-colors hover:text-fog-100 disabled:opacity-40"
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
              className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-400 transition-colors hover:text-fog-100 disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
