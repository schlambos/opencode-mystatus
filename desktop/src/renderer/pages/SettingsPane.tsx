import type { JSX } from "react";
import { PaneShell } from "../components/PaneShell";
import { useStatusState } from "../lib/store";

export function SettingsPane(): JSX.Element {
  const { config } = useStatusState();

  return (
    <PaneShell testId="pane-settings" kicker="Wave 4" title="Settings">
      <div className="animate-rise max-w-2xl rounded-lg border border-ink-700 bg-ink-900 p-6">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7 text-fog-500"
          aria-hidden
        >
          <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
        </svg>
        <p className="mt-4 text-sm leading-relaxed text-fog-300">
          Full control over <span className="font-mono text-xs">mystatus.json</span> (sort,
          summary, trends, intervals, provider enable/disable) plus desktop-only preferences in{" "}
          <span className="font-mono text-xs">mystatus-desktop.json</span> lands in wave 4.
        </p>
        <p className="mt-3 font-mono text-xs text-fog-500" data-testid="settings-config-hint">
          {config === null
            ? "No config snapshot yet — the core bridge (todo 2) provides it."
            : `Config snapshot loaded · ${Object.keys(config).length} keys`}
        </p>
      </div>
    </PaneShell>
  );
}
