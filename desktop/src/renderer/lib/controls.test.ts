// Parity tests for the client-side control logic (todo 8).
//
// Fixtures are hand-derived from core sortCells (plugin/mystatus.ts:7119-7137)
// and buildMyStatusViewModel bucketing (plugin/mystatus.ts:7339-7348):
//   name    → localeCompare(sensitivity: "base")
//   reset   → soonestResetMs ?? Infinity, ascending
//   urgency → minRemaining (>100 clamped to 101) asc, then soonest reset,
//             then name — applied BY THE CORE before the view model is
//             pushed, so sortProviders("urgency") preserves model order
//   tally   → per provider: min>100 skipped · ≥50 green · ≥threshold yellow · else red

import { describe, expect, it } from "vitest";
import type { MyStatusViewProvider } from "../../shared/ipc.js";
import {
  bucketTallies,
  clampThreshold,
  controlsBaselines,
  defaultControls,
  isControlsDirty,
  sortProviders,
} from "./controls.js";

function prov(
  name: string,
  minRemaining: number,
  soonestResetMs?: number,
): MyStatusViewProvider {
  return {
    name,
    minRemaining,
    windows: [{ label: "Window", remaining: minRemaining }],
    ...(soonestResetMs === undefined ? {} : { soonestResetMs }),
  };
}

describe("sortProviders — sortCells parity", () => {
  it("name mode sorts case-insensitively by locale", () => {
    const input = [prov("Poe Account Quota", 46), prov("anthropic", 49), prov("Google — jane", 0)];

    const sorted = sortProviders(input, "name").map((p) => p.name);

    expect(sorted).toEqual(["anthropic", "Google — jane", "Poe Account Quota"]);
  });

  it("reset mode sorts by soonestResetMs ascending, providers without a reset last", () => {
    const input = [prov("NoReset", 50), prov("Later", 50, 7_200_000), prov("Sooner", 50, 60_000)];

    const sorted = sortProviders(input, "reset").map((p) => p.name);

    expect(sorted).toEqual(["Sooner", "Later", "NoReset"]);
  });

  it("urgency mode preserves the core-sorted model order", () => {
    // Hand-computed sortCells("urgency") order: min asc with >100 → 101,
    // ties by soonest reset, then name. 150% clamps next to 101% and loses
    // the tie on the later reset.
    const coreSorted = [
      prov("Google — jane", 0),
      prov("MiniMax Token Plan", 3, 3_600_000),
      prov("xAI/Grok", 22),
      prov("Poe Account Quota", 46),
      prov("Anthropic Account Quota", 49, 4_200_000),
      prov("OpenAI Account Quota", 49, 15_600_000),
      prov("Mistral Vibe Usage", 96),
      prov("StepFun Token Plan", 100, 1_800_000),
      prov("Ollama Cloud", 101, 3_600_000),
      prov("BytePlus Coding Plan", 150, 7_200_000),
    ];

    expect(sortProviders(coreSorted, "urgency").map((p) => p.name)).toEqual(
      coreSorted.map((p) => p.name),
    );
  });

  it("does not mutate the input array", () => {
    const input = [prov("b", 10), prov("a", 20)];
    sortProviders(input, "name");
    expect(input.map((p) => p.name)).toEqual(["b", "a"]);
  });
});

describe("bucketTallies — view model bucketing parity", () => {
  it("places the threshold boundary exactly: 24% red, 25% yellow at threshold 25", () => {
    const providers = [prov("JustBelow", 24), prov("AtThreshold", 25)];

    expect(bucketTallies(providers, 25)).toEqual({ green: 0, yellow: 1, red: 1 });
  });

  it("places the green boundary exactly: 49% yellow, 50% green", () => {
    const providers = [prov("AlmostHalf", 49), prov("Half", 50)];

    expect(bucketTallies(providers, 25)).toEqual({ green: 1, yellow: 1, red: 0 });
  });

  it("re-buckets when the threshold moves: 30% flips red→yellow between 35 and 30", () => {
    const providers = [prov("Thirty", 30)];

    expect(bucketTallies(providers, 35)).toEqual({ green: 0, yellow: 0, red: 1 });
    expect(bucketTallies(providers, 30)).toEqual({ green: 0, yellow: 1, red: 0 });
  });

  it("counts 0% as red and skips providers whose minimum exceeds 100", () => {
    const providers = [prov("Dead", 0), prov("Overflow", 150), prov("Healthy", 80)];

    expect(bucketTallies(providers, 25)).toEqual({ green: 1, yellow: 0, red: 1 });
  });

  it("tallies an empty provider list to zeros", () => {
    expect(bucketTallies([], 25)).toEqual({ green: 0, yellow: 0, red: 0 });
  });
});

describe("clampThreshold", () => {
  it("clamps into the 5–50 slider range", () => {
    expect(clampThreshold(3)).toBe(5);
    expect(clampThreshold(80)).toBe(50);
    expect(clampThreshold(25)).toBe(25);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampThreshold(Number.NaN)).toBe(25);
    expect(clampThreshold(Number.POSITIVE_INFINITY)).toBe(25);
  });
});

describe("controlsBaselines / isControlsDirty", () => {
  it("derives defaults when config and prefs are unavailable", () => {
    expect(controlsBaselines(null, null)).toEqual(defaultControls());
  });

  it("prefers persisted config sort/trend and prefs threshold", () => {
    const baselines = controlsBaselines(
      { sort: "name", trend: "full" },
      {
        threshold: 30,
        trendMode: undefined,
        notifications: true,
        notifyCooldownMin: 60,
        lastTab: undefined,
        windowBounds: undefined,
        launchAtLogin: false,
      },
    );

    expect(baselines).toEqual({ sortMode: "name", trendMode: "full", threshold: 30 });
  });

  it("flags each field difference as dirty and an exact match as clean", () => {
    const baselines = { sortMode: "urgency" as const, threshold: 25, trendMode: "compact" as const };

    expect(isControlsDirty(baselines, baselines)).toBe(false);
    expect(isControlsDirty({ ...baselines, sortMode: "reset" }, baselines)).toBe(true);
    expect(isControlsDirty({ ...baselines, threshold: 40 }, baselines)).toBe(true);
    expect(isControlsDirty({ ...baselines, trendMode: "full" }, baselines)).toBe(true);
  });
});
