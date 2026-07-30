// Trend sparkline + projection tests (todo 7).
//
// The delta/projection assertions reproduce the core's makeTrendFn output
// (plugin/mystatus.ts:6989-7033) character for character, so the GUI cannot
// silently drift from the one-shot/TUI trend text. Rendering is asserted via
// react-dom/server — no DOM or extra deps required.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildSeriesMap,
  computeTrend,
  formatCoreDuration,
  seriesKey,
  sparkTone,
} from "../lib/trend";
import { Sparkline } from "./Sparkline";
import { TrendRow } from "./TrendRow";

const NOW = 1_750_000_000_000;
const TWO_HOURS = 7_200_000;

describe("seriesKey", () => {
  it("joins provider name and window label exactly like the core", () => {
    // PARITY: plugin/mystatus.ts:7046 — `${m.cellTitle}::${m.label}`
    expect(seriesKey("Anthropic Account Quota", "5-hour limit")).toBe(
      "Anthropic Account Quota::5-hour limit",
    );
  });
});

describe("buildSeriesMap", () => {
  it("groups snapshot values per key in snapshot order", () => {
    const map = buildSeriesMap([
      { ts: 1, values: { a: 10, b: 20 } },
      { ts: 2, values: { a: 30 } },
    ]);
    expect(map.get("a")).toEqual([
      { ts: 1, value: 10 },
      { ts: 2, value: 30 },
    ]);
    expect(map.get("b")).toEqual([{ ts: 1, value: 20 }]);
    expect(map.get("missing")).toBeUndefined();
  });
});

describe("formatCoreDuration (parity with plugin/mystatus.ts:246-257)", () => {
  it("keeps every non-zero unit and falls back to minutes", () => {
    expect(formatCoreDuration(0)).toBe("0m");
    expect(formatCoreDuration(59)).toBe("0m");
    expect(formatCoreDuration(60)).toBe("1m");
    expect(formatCoreDuration(3599)).toBe("59m");
    expect(formatCoreDuration(3600)).toBe("1h");
    expect(formatCoreDuration(5400)).toBe("1h 30m");
    expect(formatCoreDuration(86400)).toBe("1d");
    expect(formatCoreDuration(90000)).toBe("1d 1h");
    expect(formatCoreDuration(90060)).toBe("1d 1h 1m");
  });

  it("clamps negatives and rejects non-finite input", () => {
    expect(formatCoreDuration(-5)).toBe("0m");
    expect(formatCoreDuration(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatCoreDuration(Number.NaN)).toBe("-");
  });
});

describe("sparkTone (parity with plugin/mystatus.ts:6971)", () => {
  it("colors at the core's fixed 50/25 thresholds", () => {
    expect(sparkTone(100)).toBe("ok");
    expect(sparkTone(50)).toBe("ok");
    expect(sparkTone(49.99)).toBe("warn");
    expect(sparkTone(25)).toBe("warn");
    expect(sparkTone(24.99)).toBe("dead");
    expect(sparkTone(0)).toBe("dead");
  });
});

describe("computeTrend (parity with plugin/mystatus.ts:6989-7033)", () => {
  const series = [{ ts: NOW - TWO_HOURS, value: 75 }];

  it("renders the core's compact drain delta", () => {
    const trend = computeTrend({ series, remaining: 72, resetMs: undefined, mode: "compact", nowMs: NOW });
    expect(trend).not.toBeNull();
    expect(trend?.points).toEqual([75, 72]);
    expect(trend?.deltaText).toBe("\u25bc3%"); // ▼3%
    expect(trend?.deltaKind).toBe("drain");
    expect(trend?.projectionText).toBeNull();
  });

  it("adds the age suffix and time-to-empty projection in full mode", () => {
    const trend = computeTrend({ series, remaining: 72, resetMs: undefined, mode: "full", nowMs: NOW });
    expect(trend?.deltaText).toBe("\u25bc3%/2h"); // ▼3%/2h
    // 3% per 2h ⇒ 72% left ⇒ 48h ⇒ "2d"
    expect(trend?.projectionText).toBe("~2d to empty");
  });

  it("suppresses the projection when the window resets first", () => {
    const trend = computeTrend({ series, remaining: 72, resetMs: 3_600_000, mode: "full", nowMs: NOW });
    expect(trend?.deltaText).toBe("\u25bc3%/2h");
    expect(trend?.projectionText).toBeNull(); // 48h to empty > 1h reset
  });

  it("renders a gain delta with the full-mode age suffix", () => {
    const trend = computeTrend({ series, remaining: 79, resetMs: undefined, mode: "full", nowMs: NOW });
    expect(trend?.deltaText).toBe("\u25b24%/2h"); // ▲4%/2h
    expect(trend?.deltaKind).toBe("gain");
    expect(trend?.projectionText).toBeNull();
  });

  it("treats a jump above +5 as a reset", () => {
    const compact = computeTrend({ series, remaining: 81, resetMs: undefined, mode: "compact", nowMs: NOW });
    const full = computeTrend({ series, remaining: 81, resetMs: undefined, mode: "full", nowMs: NOW });
    expect(compact?.deltaText).toBe("\u2191 reset"); // ↑ reset
    expect(full?.deltaText).toBe("\u2191 reset"); // no age suffix on resets
    expect(compact?.deltaKind).toBe("reset");
  });

  it("treats movement within ±1 as flat", () => {
    const trend = computeTrend({ series, remaining: 75, resetMs: undefined, mode: "full", nowMs: NOW });
    expect(trend?.deltaText).toBe("\u2192 0%"); // → 0%
    expect(trend?.deltaKind).toBe("flat");
  });

  it("keeps boundary deltas on the core's branches (+5 is a gain, -1 is a drain)", () => {
    const gain = computeTrend({ series, remaining: 80, resetMs: undefined, mode: "compact", nowMs: NOW });
    const drain = computeTrend({ series, remaining: 74, resetMs: undefined, mode: "compact", nowMs: NOW });
    expect(gain?.deltaText).toBe("\u25b25%");
    expect(drain?.deltaText).toBe("\u25bc1%");
  });

  it("prints fractional deltas verbatim like the core", () => {
    const trend = computeTrend({
      series: [{ ts: NOW - TWO_HOURS, value: 75.5 }],
      remaining: 72,
      resetMs: undefined,
      mode: "compact",
      nowMs: NOW,
    });
    expect(trend?.deltaText).toBe("\u25bc3.5%");
  });

  it("returns null with no history (first run shows no trend)", () => {
    expect(computeTrend({ series: [], remaining: 72, resetMs: undefined, mode: "full", nowMs: NOW })).toBeNull();
  });

  it("caps the sparkline at the last 10 points including the live value", () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ ts: NOW - (12 - i) * 60_000, value: 100 - i }));
    const trend = computeTrend({ series: long, remaining: 50, resetMs: undefined, mode: "compact", nowMs: NOW });
    expect(trend?.points).toHaveLength(10);
    expect(trend?.points[trend.points.length - 1]).toBe(50);
    expect(trend?.points[0]).toBe(97);
  });
});

describe("<Sparkline />", () => {
  it("renders one colored point per value plus a live ring on the last", () => {
    const html = renderToStaticMarkup(<Sparkline values={[80, 40, 10]} />);
    expect(html).toContain('data-testid="sparkline"');
    expect(html.match(/data-testid="spark-point"/g)).toHaveLength(3);
    expect(html).toContain("fill-status-ok");
    expect(html).toContain("fill-status-warn");
    expect(html).toContain("fill-status-dead");
    expect(html).toContain('data-testid="spark-live"');
    expect(html).toContain("stroke-status-dead");
    expect(html).toContain("80% remaining");
  });

  it("renders nothing with fewer than two points", () => {
    expect(renderToStaticMarkup(<Sparkline values={[50]} />)).toBe("");
    expect(renderToStaticMarkup(<Sparkline values={[]} />)).toBe("");
  });
});

describe("<TrendRow />", () => {
  const series = [{ ts: NOW - TWO_HOURS, value: 75 }];

  it("renders delta, sparkline, and projection in the core's part order", () => {
    const trend = computeTrend({ series, remaining: 72, resetMs: undefined, mode: "full", nowMs: NOW });
    expect(trend).not.toBeNull();
    const html = renderToStaticMarkup(<TrendRow trend={trend!} />);
    expect(html).toContain("\u25bc3%/2h");
    expect(html).toContain("~2d to empty");
    expect(html).toContain('data-testid="sparkline"');
    expect(html.indexOf("\u25bc3%/2h")).toBeLessThan(html.indexOf('data-testid="sparkline"'));
    expect(html.indexOf('data-testid="sparkline"')).toBeLessThan(html.indexOf("~2d to empty"));
  });

  it("omits the projection in compact mode", () => {
    const trend = computeTrend({ series, remaining: 72, resetMs: undefined, mode: "compact", nowMs: NOW });
    const html = renderToStaticMarkup(<TrendRow trend={trend!} />);
    expect(html).toContain("\u25bc3%");
    expect(html).not.toContain("to empty");
  });
});
