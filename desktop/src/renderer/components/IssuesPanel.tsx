import type { JSX } from "react";
import type { MyStatusViewModel } from "../../shared/ipc";
import { groupAttentionIssues, isCookieProvider, unconfiguredNames } from "../lib/issues";

function healthLine(model: MyStatusViewModel): string {
  const h = model.health;
  const parts = [`${h.rendered} of ${h.queried} providers reporting`];
  if (h.failed) parts.push(`${h.failed} failed`);
  if (h.stale) parts.push(`${h.stale} stale`);
  if (h.unconfigured) parts.push(`${h.unconfigured} not configured`);
  return parts.join(" \u00b7 ");
}

/**
 * Issues tab: health line, error/stale groups with sub-account collapse, and a
 * compact not-configured list (PARITY plugin/tui.ts:538-563). Cookie-provider
 * rows offer a "Set up" jump to the Credentials page.
 */
export function IssuesPanel({
  model,
  onOpenCredentials,
}: {
  model: MyStatusViewModel;
  onOpenCredentials?: () => void;
}): JSX.Element {
  const groups = groupAttentionIssues(model.issues);
  const unconfigured = unconfiguredNames(model.issues);

  return (
    <section data-testid="issues-panel" className="animate-rise">
      <p data-testid="issues-health" className="font-mono text-xs text-fog-500">
        {healthLine(model)}
      </p>

      {groups.length === 0 ? (
        <p
          data-testid="issues-empty"
          className="mt-4 rounded-md border border-ink-700/70 bg-ink-900/70 px-3.5 py-3 text-sm text-fog-400"
        >
          Every configured provider answered live — nothing to fix.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {groups.map((g, i) => {
            const isError = g.kind === "error";
            const wantsSetup = onOpenCredentials !== undefined && g.providers.some(isCookieProvider);
            return (
              <li
                key={`${g.kind}-${g.provider}-${String(i)}`}
                data-testid="issue-row"
                data-kind={g.kind}
                className="flex items-start gap-3 rounded-md border border-ink-700/70 bg-ink-900/70 px-3.5 py-2.5"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    isError ? "bg-status-dead/15 text-status-dead" : "bg-status-warn/15 text-status-warn"
                  }`}
                >
                  !
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span data-testid="issue-provider" className="text-sm font-medium text-fog-100">
                      {g.provider}
                    </span>
                    <span
                      data-testid="issue-status"
                      className={`font-mono text-xs tabular-nums ${
                        isError ? "text-status-dead" : "text-status-warn"
                      }`}
                    >
                      {g.status}
                    </span>
                    {wantsSetup && (
                      <button
                        type="button"
                        data-testid="issue-setup"
                        onClick={onOpenCredentials}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors duration-150 hover:bg-accent/10"
                      >
                        Set up
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-fog-500" title={g.detail}>
                    {g.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unconfigured !== "" && (
        <p data-testid="issues-unconfigured" className="mt-4 text-xs leading-relaxed text-fog-600">
          Not configured: {unconfigured}
        </p>
      )}
    </section>
  );
}
