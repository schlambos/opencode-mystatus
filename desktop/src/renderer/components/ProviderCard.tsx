import type { JSX, ReactNode } from "react";
import type { MyStatusViewWindow } from "../../shared/ipc";
import { formatDuration } from "../lib/status";
import { Meter } from "./Meter";

interface ProviderCardProps {
  name: string;
  // `| undefined` because callers pass `provider.stale` straight through under
  // exactOptionalPropertyTypes — absence and explicit undefined both mean
  // "not stale".
  stale?: { ageMs: number; reason?: string } | undefined;
  note?: string | undefined;
  windows: MyStatusViewWindow[];
  threshold: number;
  fetchedAt: number | null;
  now: number;
  delayMs?: number;
  /** Trailing header actions (unhide button today; per-card hide button in todo 9). */
  actions?: ReactNode;
}

/** One provider block: name + stale badge, optional note, one meter per window. */
export function ProviderCard({
  name,
  stale,
  note,
  windows,
  threshold,
  fetchedAt,
  now,
  delayMs = 0,
  actions,
}: ProviderCardProps): JSX.Element {
  return (
    <article
      data-testid="provider-card"
      data-provider-name={name}
      className="animate-rise rounded-lg border border-ink-700 bg-gradient-to-b from-ink-850 to-ink-900 p-4 transition-colors duration-200 hover:border-ink-600"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <header className="flex items-center gap-2.5">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fog-100">{name}</h3>
        {stale !== undefined && (
          <span
            data-testid="stale-badge"
            title={stale.reason ?? "Live query failed; showing cached numbers"}
            className="rounded border border-status-warn/40 bg-status-warn/10 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-status-warn"
          >
            stale {formatDuration(Math.floor(stale.ageMs / 1000))}
          </span>
        )}
        {actions}
      </header>
      {note !== undefined && note !== "" && (
        <p data-testid="provider-note" className="mt-1 truncate font-mono text-[11px] text-fog-500">
          {note}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {windows.length > 0 ? (
          windows.map((w) => (
            <Meter key={w.label} window={w} threshold={threshold} fetchedAt={fetchedAt} now={now} />
          ))
        ) : (
          <p className="text-xs text-fog-600">No quota windows in the latest sync.</p>
        )}
      </div>
    </article>
  );
}
