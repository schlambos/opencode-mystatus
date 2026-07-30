import type { JSX } from "react";
import type { DeltaKind, TrendView } from "../lib/trend";
import { Sparkline } from "./Sparkline";

const deltaTextClass: Record<DeltaKind, string> = {
  drain: "text-status-dead",
  gain: "text-status-ok",
  reset: "text-status-ok",
  flat: "text-fog-400",
};

export interface TrendRowProps {
  trend: TrendView;
  sparklineWidth?: number;
}

// Renders one trend annotation in the core's part order
// (plugin/mystatus.ts:7009-7024): delta, sparkline, projection.
export function TrendRow({ trend, sparklineWidth }: TrendRowProps): JSX.Element {
  return (
    <span data-testid="trend-row" className="inline-flex items-center gap-2.5">
      {trend.deltaText !== null && (
        <span
          data-testid="trend-delta"
          className={`font-mono text-xs font-medium tabular-nums ${
            trend.deltaKind !== null ? deltaTextClass[trend.deltaKind] : "text-fog-400"
          }`}
        >
          {trend.deltaText}
        </span>
      )}
      <Sparkline values={trend.points} width={sparklineWidth} />
      {trend.projectionText !== null && (
        <span
          data-testid="trend-projection"
          className="font-mono text-xs text-status-low tabular-nums"
        >
          {trend.projectionText}
        </span>
      )}
    </span>
  );
}
