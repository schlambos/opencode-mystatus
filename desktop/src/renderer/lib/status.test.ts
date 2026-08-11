import { describe, expect, it } from "vitest";
import {
  effectiveRemaining,
  formatAge,
  formatDuration,
  offTabWorstCue,
  resetCountdown,
  statusTone,
  viewMinRemaining,
} from "./status";

// Parity anchors: plugin/mystatus.ts:48-60 (emoji tiers), plugin/tui.ts:180-197
// (fmtDur/fmtAge/pctColor), plugin/tui.ts:293-298 + 638 (resetText + ageMs).

describe("statusTone — plugin tier semantics", () => {
  it("maps ≤0 to dead regardless of threshold", () => {
    expect(statusTone(0, 25)).toBe("dead");
    expect(statusTone(-5, 5)).toBe("dead");
  });

  it("maps below-threshold (but >0) to low", () => {
    expect(statusTone(1, 25)).toBe("low");
    expect(statusTone(24, 25)).toBe("low");
    expect(statusTone(4, 5)).toBe("low");
  });

  it("maps ≥threshold and <50 to warn", () => {
    expect(statusTone(25, 25)).toBe("warn");
    expect(statusTone(49, 25)).toBe("warn");
  });

  it("maps ≥50 to ok", () => {
    expect(statusTone(50, 25)).toBe("ok");
    expect(statusTone(100, 25)).toBe("ok");
  });

  it("honors a custom threshold (slider range 5–50)", () => {
    expect(statusTone(30, 35)).toBe("low");
    expect(statusTone(35, 35)).toBe("warn");
    expect(statusTone(49, 50)).toBe("low");
    expect(statusTone(50, 50)).toBe("ok");
  });
});

describe("formatDuration — parity with tui.ts fmtDur", () => {
  it("renders days, hours, minutes like the TUI", () => {
    expect(formatDuration(90061)).toBe("1d 1h");
    expect(formatDuration(86400)).toBe("1d");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(45)).toBe("0m");
  });
});

describe("formatAge — parity with tui.ts fmtAge", () => {
  it("renders seconds, minutes, hours like the TUI", () => {
    expect(formatAge(12)).toBe("12s");
    expect(formatAge(59)).toBe("59s");
    expect(formatAge(300)).toBe("5m");
    expect(formatAge(57_600)).toBe("16h");
  });
});

describe("resetCountdown — parity with tui.ts resetText", () => {
  const fetchedAt = 1_000_000;

  it("derives time left as resetMs - (now - fetchedAt)", () => {
    // resetMs = 1h, 10 minutes have passed → 50m left.
    const result = resetCountdown(3_600_000, fetchedAt, fetchedAt + 600_000);
    expect(result).toEqual({ leftMs: 3_000_000, text: "50m" });
  });

  it("reports 'now' once the window has elapsed", () => {
    expect(resetCountdown(60_000, fetchedAt, fetchedAt + 60_000)).toEqual({ leftMs: 0, text: "now" });
    expect(resetCountdown(60_000, fetchedAt, fetchedAt + 120_000)).toEqual({
      leftMs: 0,
      text: "now",
    });
  });

  it("ignores absent or non-positive resetMs like the TUI", () => {
    expect(resetCountdown(undefined, fetchedAt, fetchedAt)).toBeNull();
    expect(resetCountdown(0, fetchedAt, fetchedAt)).toBeNull();
    expect(resetCountdown(-100, fetchedAt, fetchedAt)).toBeNull();
    expect(resetCountdown(Number.NaN, fetchedAt, fetchedAt)).toBeNull();
  });

  it("treats a missing fetchedAt as zero age", () => {
    expect(resetCountdown(120_000, null, 999_999)).toEqual({ leftMs: 120_000, text: "2m" });
  });

  it("formats multi-day countdowns via fmtDur", () => {
    // 4d 7h 50m left, like the README sample.
    const ms = ((4 * 24 + 7) * 60 + 50) * 60 * 1000;
    expect(resetCountdown(ms, fetchedAt, fetchedAt)?.text).toBe("4d 7h");
  });
});

describe("viewMinRemaining", () => {
  it("returns null for empty windows", () => {
    expect(viewMinRemaining([])).toBeNull();
  });

  it("returns the lowest remaining among view windows", () => {
    expect(viewMinRemaining([{ remaining: 100 }, { remaining: 0 }, { remaining: 40 }])).toBe(0);
    expect(viewMinRemaining([{ remaining: 100 }])).toBe(100);
  });
});

describe("effectiveRemaining", () => {
  it("prefers window mins and ignores the 101 no-meter sentinel", () => {
    expect(effectiveRemaining([{ remaining: 40 }], 101)).toBe(40);
    expect(effectiveRemaining([], 101)).toBeNull();
    expect(effectiveRemaining([], 100)).toBe(100);
    expect(effectiveRemaining([], undefined)).toBeNull();
  });
});

describe("offTabWorstCue — Kimi-shaped badge/pills mismatch", () => {
  const tierOf = (label: string): "short" | "weekly" | "monthly" => {
    const l = label.toLowerCase();
    if (l.includes("week")) return "weekly";
    if (l.includes("month")) return "monthly";
    return "short";
  };

  const kimi = [
    { label: "5-hour", remaining: 100, resetMs: 5 * 3_600_000 },
    { label: "Weekly", remaining: 0, resetMs: 6 * 24 * 3_600_000 },
  ];

  it("cues Weekly 0% when Current only shows 5h 100%", () => {
    const view = [kimi[0]!];
    expect(offTabWorstCue(kimi, view, tierOf)).toEqual({
      horizonLabel: "Weekly",
      remaining: 0,
      windowLabel: "Weekly",
    });
  });

  it("returns null when the global worst is already on-tab", () => {
    expect(offTabWorstCue(kimi, kimi, tierOf)).toBeNull();
    expect(offTabWorstCue(kimi, [kimi[1]!], tierOf)).toBeNull();
  });
});
