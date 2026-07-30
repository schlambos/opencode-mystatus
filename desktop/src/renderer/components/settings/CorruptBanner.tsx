import type { JSX } from "react";

interface CorruptBannerProps {
  error: string;
  path: string;
  resetting: boolean;
  resetError: string | null;
  onReinspect: () => void;
  onReset: () => void;
}

export function CorruptBanner({
  error,
  path,
  resetting,
  resetError,
  onReinspect,
  onReset,
}: CorruptBannerProps): JSX.Element {
  return (
    <div
      data-testid="settings-corrupt"
      className="rounded-lg border border-status-dead/50 bg-status-dead/10 p-5"
    >
      <p className="text-sm font-semibold text-status-dead">mystatus.json is not parseable</p>
      <p className="mt-1.5 font-mono text-xs break-all text-fog-400">{error}</p>
      {path !== "" && <p className="mt-1 font-mono text-xs break-all text-fog-500">{path}</p>}
      <p className="mt-2.5 text-xs text-fog-300">
        Saving is disabled so the file is not overwritten — fix it by hand, or reset it to an empty
        config.
      </p>
      <div className="mt-3.5 flex items-center gap-2.5">
        <button
          type="button"
          data-testid="corrupt-reinspect"
          onClick={onReinspect}
          className="rounded-md border border-ink-600 bg-ink-950/70 px-3 py-1.5 text-xs font-semibold text-fog-200 transition-colors duration-150 hover:border-ink-700 hover:text-fog-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
        >
          Re-read file
        </button>
        <button
          type="button"
          data-testid="corrupt-reset"
          disabled={resetting}
          onClick={onReset}
          className="rounded-md border border-status-dead/50 bg-status-dead/10 px-3 py-1.5 text-xs font-semibold text-status-dead transition-colors duration-150 hover:bg-status-dead/20 focus-visible:ring-1 focus-visible:ring-status-dead focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {resetting ? "Resetting…" : "Reset file to {}"}
        </button>
        {resetError !== null && (
          <span data-testid="corrupt-reset-error" className="text-xs text-status-low">
            {resetError}
          </span>
        )}
      </div>
    </div>
  );
}
