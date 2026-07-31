import type { JSX } from "react";
import { sparkTone } from "../lib/trend";
import { toneFillClass, toneStrokeClass } from "../lib/status";

export interface SparklineProps {
  /** Percent-remaining values, oldest → newest (last = live value). */
  values: number[];
  // `| undefined`: callers forward an optional width straight through.
  width?: number | undefined;
  height?: number;
  ariaLabel?: string;
}

const PAD_X = 4;
const PAD_Y = 4;

export function Sparkline({
  values,
  width = 116,
  height = 28,
  ariaLabel = "usage trend",
}: SparklineProps): JSX.Element | null {
  if (values.length < 2) return null;

  const innerW = width - PAD_X * 2;
  const innerH = height - PAD_Y * 2;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const yFor = (v: number): number =>
    PAD_Y + (1 - Math.max(0, Math.min(100, v)) / 100) * innerH;

  const pts = values.map((v, i) => ({
    x: PAD_X + i * stepX,
    y: yFor(v),
    v,
  }));
  const polyline = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  if (last === undefined) return null;

  return (
    <svg
      data-testid="sparkline"
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      className="shrink-0 overflow-visible"
    >
      {/* tier guides at 50% / 25% — the core's fixed spark color thresholds */}
      <line
        x1={PAD_X}
        x2={width - PAD_X}
        y1={yFor(50)}
        y2={yFor(50)}
        className="stroke-ink-700"
        strokeWidth={1}
        strokeDasharray="2 4"
        opacity={0.6}
      />
      <line
        x1={PAD_X}
        x2={width - PAD_X}
        y1={yFor(25)}
        y2={yFor(25)}
        className="stroke-ink-700"
        strokeWidth={1}
        strokeDasharray="2 4"
        opacity={0.35}
      />
      <polyline
        points={polyline}
        fill="none"
        className="stroke-ink-600"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((p, i) => {
        const tone = sparkTone(p.v);
        return (
          <circle
            key={i}
            data-testid="spark-point"
            className={`spark-point ${toneFillClass[tone]}`}
            cx={p.x}
            cy={p.y}
            r={2.4}
          >
            <title>{`${Math.round(p.v)}% remaining`}</title>
          </circle>
        );
      })}
      <circle
        data-testid="spark-live"
        className={`animate-blink ${toneStrokeClass[sparkTone(last.v)]}`}
        cx={last.x}
        cy={last.y}
        r={5}
        fill="none"
        strokeWidth={1}
        opacity={0.8}
      />
    </svg>
  );
}
