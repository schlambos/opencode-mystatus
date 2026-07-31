import type { JSX } from "react";
import { useStatusState } from "../lib/store";
import { hiddenNameSet, setProviderHidden } from "../lib/hiddenProviders";
import { resetCountdown, statusTone, toneTextClass } from "../lib/status";
import type { MyStatusViewProvider } from "../../shared/ipc";

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
    <div className="flex gap-[3px]" aria-hidden>
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
  threshold,
  fetchedAt,
  now,
}: {
  provider: MyStatusViewProvider;
  threshold: number;
  fetchedAt: number | null;
  now: number;
}): JSX.Element {
  const pct = provider.minRemaining;
  const tone = statusTone(pct, threshold);
  const reset = resetCountdown(provider.soonestResetMs, fetchedAt, now);

  return (
    <li
      data-testid="provider-row"
      data-provider-name={provider.name}
      className="group flex items-center gap-4 py-2.5"
    >
      <span className="w-44 shrink-0 truncate text-sm text-fog-100">{provider.name}</span>
      <Bar pct={pct} threshold={threshold} />
      <span className={`w-12 text-right font-mono text-sm tabular-nums ${toneTextClass[tone]}`}>
        {pct}%
      </span>
      <span className="w-20 text-right font-mono text-xs tabular-nums text-fog-500">
        {reset === null ? "" : reset.text}
      </span>
      <button
        type="button"
        title={`Hide ${provider.name}`}
        onClick={() => void setProviderHidden(provider.name, true)}
        className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 text-fog-600 hover:text-fog-200"
      >
        ×
      </button>
    </li>
  );
}

export function DashboardPane(): JSX.Element {
  const { model, config, fetchedAt, now, modelError } = useStatusState();

  if (model === null) {
    return (
      <p className="px-6 py-8 text-sm text-fog-500">
        {modelError ?? "Loading…"}
      </p>
    );
  }

  const hidden = hiddenNameSet(config);
  const rows = model.providers
    .filter((p) => !hidden.has(p.name.toLowerCase()))
    .slice()
    .sort((a, b) => a.minRemaining - b.minRemaining);

  return (
    <div className="px-6 py-4">
      {modelError !== null && (
        <p className="mb-3 text-xs text-status-low">Last sync failed — showing previous data.</p>
      )}
      <ul className="divide-y divide-ink-800">
        {rows.map((p) => (
          <Row
            key={p.name}
            provider={p}
            threshold={model.threshold}
            fetchedAt={fetchedAt}
            now={now}
          />
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="py-8 text-sm text-fog-500">Nothing to show. Add credentials with the gear.</p>
      )}
    </div>
  );
}
