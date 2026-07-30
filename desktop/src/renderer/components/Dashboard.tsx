import { useState, type JSX } from "react";
import type { MyStatusViewModel } from "../../shared/ipc";
import { hiddenNameSet, hiddenProviders, setProviderHidden } from "../lib/hiddenProviders";
import { useStatusState } from "../lib/store";
import { groupsForHorizon, type Horizon } from "../lib/tiers";
import { HideButton } from "./HideButton";
import { IssuesPanel } from "./IssuesPanel";
import { ProviderCard } from "./ProviderCard";

type Tab = Horizon | "issues" | "hidden";

// PARITY: plugin/tui.ts:49-53 — tab titles and hints are quoted verbatim so
// empty states read exactly like the TUI's (`No monthly quotas · …`, tui.ts:670).
const QUOTA_TABS: Array<{ id: Horizon; title: string; hint: string }> = [
  { id: "current", title: "Current", hint: "what you have left now" },
  { id: "weekly", title: "Weekly", hint: "7-day / weekly limits" },
  { id: "monthly", title: "Monthly", hint: "monthly / credits (multi-tier only)" },
];

function TabButton({
  testId,
  active,
  onClick,
  label,
  badge,
  badgeTone,
}: {
  testId: string;
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  badgeTone?: "warn" | "accent";
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-xs font-semibold tracking-[0.14em] uppercase transition-colors duration-150 ${
        active
          ? "border-accent text-fog-100"
          : "border-transparent text-fog-500 hover:text-fog-200"
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          data-testid={`${testId}-badge`}
          className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] normal-case tabular-nums ${
            badgeTone === "warn" ? "bg-status-warn/15 text-status-warn" : "bg-accent/15 text-accent"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function QuotaTab({
  model,
  horizon,
  hidden,
  fetchedAt,
  now,
}: {
  model: MyStatusViewModel;
  horizon: Horizon;
  hidden: Set<string>;
  fetchedAt: number | null;
  now: number;
}): JSX.Element {
  // One pushed model, split client-side — tabs never re-query (plan todo 6).
  // Hidden providers are filtered here, same as the TUI (tui.ts:659).
  const visible = model.providers.filter((p) => !hidden.has(p.name.toLowerCase()));
  const groups = groupsForHorizon(visible, horizon);
  const tab = QUOTA_TABS.find((t) => t.id === horizon);

  if (groups.length === 0) {
    return (
      <p data-testid="quota-empty" className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-6 text-sm text-fog-500">
        No {tab === undefined ? horizon : tab.title.toLowerCase()} quotas{" "}
        <span className="text-fog-600">· {tab === undefined ? "" : tab.hint}</span>
      </p>
    );
  }

  return (
    <div data-testid="quota-grid" className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {groups.map((g, i) => (
        <ProviderCard
          key={g.provider.name}
          name={g.provider.name}
          stale={g.provider.stale}
          note={g.provider.note}
          windows={g.windows}
          threshold={model.threshold}
          fetchedAt={fetchedAt}
          now={now}
          delayMs={Math.min(i * 45, 360)}
          actions={
            <HideButton
              name={g.provider.name}
              hidden={false}
              onToggle={(n) => void setProviderHidden(n, true)}
            />
          }
        />
      ))}
    </div>
  );
}

function HiddenTab({
  model,
  hidden,
  fetchedAt,
  now,
}: {
  model: MyStatusViewModel;
  hidden: Set<string>;
  fetchedAt: number | null;
  now: number;
}): JSX.Element {
  const rows = hiddenProviders(model.providers, hidden);
  if (rows.length === 0) {
    return (
      <p data-testid="hidden-empty" className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-6 text-sm text-fog-500">
        No hidden providers — press show on a card to bring it back.
      </p>
    );
  }
  return (
    <div data-testid="hidden-grid" className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {rows.map((p, i) => (
        <ProviderCard
          key={p.name}
          name={p.name}
          stale={p.stale}
          note={p.note}
          windows={p.windows}
          threshold={model.threshold}
          fetchedAt={fetchedAt}
          now={now}
          delayMs={Math.min(i * 45, 360)}
          actions={
            <button
              type="button"
              data-testid="unhide-button"
              data-provider-name={p.name}
              onClick={() => void setProviderHidden(p.name, false)}
              className="rounded border border-ink-600 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-fog-400 uppercase transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              Show
            </button>
          }
        />
      ))}
    </div>
  );
}

/** Horizon tabs + provider cards over the single pushed view model. */
export function Dashboard(): JSX.Element | null {
  const { model, config, fetchedAt, now } = useStatusState();
  const [tab, setTab] = useState<Tab>("current");

  if (model === null) return null;

  const hidden = hiddenNameSet(config);
  const hiddenCount = hiddenProviders(model.providers, hidden).length;
  // PARITY: plugin/tui.ts:689 — the Issues badge counts failed + stale.
  const issueBadge = model.health.failed + model.health.stale;

  return (
    <section data-testid="dashboard" className="mt-8">
      <div data-testid="dashboard-tabs" className="flex items-center border-b border-ink-700">
        {QUOTA_TABS.map((t) => (
          <TabButton
            key={t.id}
            testId={`tab-${t.id}`}
            label={t.title}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          />
        ))}
        <TabButton
          testId="tab-issues"
          label="Issues"
          badge={issueBadge}
          badgeTone="warn"
          active={tab === "issues"}
          onClick={() => setTab("issues")}
        />
        {hiddenCount > 0 && (
          <TabButton
            testId="tab-hidden"
            label="Hidden"
            badge={hiddenCount}
            badgeTone="accent"
            active={tab === "hidden"}
            onClick={() => setTab("hidden")}
          />
        )}
      </div>

      <div className="mt-5">
        {tab === "issues" ? (
          <IssuesPanel model={model} />
        ) : tab === "hidden" ? (
          <HiddenTab model={model} hidden={hidden} fetchedAt={fetchedAt} now={now} />
        ) : (
          <QuotaTab model={model} horizon={tab} hidden={hidden} fetchedAt={fetchedAt} now={now} />
        )}
      </div>
    </section>
  );
}
