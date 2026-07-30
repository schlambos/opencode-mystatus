import type { JSX } from "react";
import type { MyStatusViewWindow } from "../../shared/ipc";
import { resetCountdown, statusTone, toneDotClass, toneTextClass } from "../lib/status";

interface MeterProps {
  window: MyStatusViewWindow;
  threshold: number;
  fetchedAt: number | null;
  now: number;
}

/** One quota window row: label, tone-colored bar, percent, live reset countdown. */
export function Meter({ window, threshold, fetchedAt, now }: MeterProps): JSX.Element {
  const tone = statusTone(window.remaining, threshold);
  const fill = Math.max(0, Math.min(100, window.remaining));
  const countdown = resetCountdown(window.resetMs, fetchedAt, now);

  return (
    <div
      data-testid="meter-row"
      data-window-label={window.label}
      className="grid grid-cols-[minmax(0,11rem)_1fr_3rem_4.5rem] items-center gap-3"
    >
      <span className="truncate text-xs text-fog-400" title={window.label}>
        {window.label}
      </span>
      <div className="h-2 overflow-hidden rounded-full bg-ink-750">
        <div
          data-testid="meter-fill"
          data-tone={tone}
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${toneDotClass[tone]}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span
        data-testid="meter-pct"
        className={`text-right font-mono text-xs font-semibold tabular-nums ${toneTextClass[tone]}`}
      >
        {window.remaining}%
      </span>
      <span
        data-testid="meter-countdown"
        className="text-right font-mono text-[11px] tabular-nums whitespace-nowrap text-fog-500"
      >
        {countdown !== null ? `↻ ${countdown.text}` : ""}
      </span>
    </div>
  );
}
