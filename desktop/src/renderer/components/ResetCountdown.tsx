import type { JSX } from "react";
import { resetCountdown } from "../lib/status";
import { useStatusState } from "../lib/store";

export interface ResetCountdownProps {
  resetMs: number | undefined;
  className?: string;
}

// Live per-window reset countdown. Ticks with the store's 1s interval:
// remaining time is derived as resetMs - (now - fetchedAt), the TUI's math
// (plugin/tui.ts:293-298).
export function ResetCountdown({ resetMs, className }: ResetCountdownProps): JSX.Element {
  const { fetchedAt, now } = useStatusState();
  const countdown = resetCountdown(resetMs, fetchedAt, now);
  return (
    <span
      data-testid="reset-countdown"
      className={`font-mono text-xs text-fog-200 tabular-nums ${className ?? ""}`}
    >
      {countdown !== null ? (
        <>
          <span className="text-fog-500" aria-hidden>
            {"\u21bb "}
          </span>
          {countdown.text}
        </>
      ) : (
        <span className="text-fog-600">{"\u2014"}</span>
      )}
    </span>
  );
}
