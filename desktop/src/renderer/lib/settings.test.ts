// Settings form logic (todo 14): defaults mirror the core (README +
// mystatus.example.json), providers payloads are always fully formed, and
// unknown provider ids in an existing config are never dropped.

import { describe, expect, it } from "vitest";
import type { MyStatusConfig } from "../../shared/ipc";
import {
  draftFromConfig,
  isPrefsDirty,
  isSectionDirty,
  moveOrderItem,
  prefsDraftFrom,
  prefsProblems,
  sectionPayload,
  sectionProblems,
  toggleDisabled,
  WATCH_INTERVAL_MIN,
} from "./settings";

describe("draftFromConfig", () => {
  it("falls back to core defaults for an empty config", () => {
    const draft = draftFromConfig({});
    expect(draft.sort).toBe("urgency");
    expect(draft.summary).toBe(true);
    expect(draft.trend).toBe("compact");
    expect(draft.cacheTtlSec).toBe(0);
    expect(draft.historyMax).toBe(60);
    expect(draft.historyMinIntervalSec).toBe(60);
    expect(draft.watchIntervalSec).toBe(60);
    expect(draft.uiRefreshSec).toBe(1);
    expect(draft.disabled).toEqual([]);
    expect(draft.agtEnabled).toBe(true);
    expect(draft.agtUsageHours).toBe(168);
    expect(draft.agtIncludeUsage).toBe(true);
  });

  it("adopts configured values and ignores invalid enum strings", () => {
    const draft = draftFromConfig({
      sort: "name",
      summary: false,
      trend: "full",
      watchIntervalSec: 90,
      providers: { disabled: ["xai"], order: ["poe"] },
      google: { excludeEmails: ["a@b.co"] },
      antigravityTools: { enabled: false, usageHours: 24, baseUrl: "http://x" },
    });
    expect(draft.sort).toBe("name");
    expect(draft.summary).toBe(false);
    expect(draft.trend).toBe("full");
    expect(draft.watchIntervalSec).toBe(90);
    expect(draft.disabled).toEqual(["xai"]);
    expect(draft.order).toEqual(["poe"]);
    expect(draft.excludeEmails).toEqual(["a@b.co"]);
    expect(draft.agtEnabled).toBe(false);
    expect(draft.agtUsageHours).toBe(24);
    expect(draft.agtBaseUrl).toBe("http://x");

    // Runtime coercion is the contract: garbage enum strings from a hand-edited
    // file must fall back to defaults, so feed the draft a mistyped config.
    const invalid = draftFromConfig({ sort: "sideways", trend: "spicy" } as unknown as MyStatusConfig);
    expect(invalid.sort).toBe("urgency");
    expect(invalid.trend).toBe("compact");
  });

  it("preserves unknown provider ids in disabled verbatim", () => {
    const draft = draftFromConfig({ providers: { disabled: ["xai", "future-provider"] } });
    expect(draft.disabled).toEqual(["xai", "future-provider"]);
  });
});

describe("sectionPayload", () => {
  const baseline = draftFromConfig({});

  it("spreads on-disk providers.hidden into the providers payload", () => {
    const draft = { ...baseline, disabled: ["xai"] };
    const payload = sectionPayload("providers", draft, {
      providers: { hidden: ["poe"], order: ["openai"] },
    });
    expect(payload.providers).toEqual({ disabled: ["xai"], order: [], hidden: ["poe"] });
  });

  it("omits hidden when the on-disk config has none", () => {
    const payload = sectionPayload("providers", baseline, {});
    expect(payload.providers).toEqual({ disabled: [], order: [] });
    expect(payload.providers).not.toHaveProperty("hidden");
  });

  it("always writes all six antigravityTools keys so cleared secrets do not survive", () => {
    const draft = { ...baseline, agtApiKey: "", agtBaseUrl: "http://127.0.0.1:8045" };
    const payload = sectionPayload("antigravity", draft, {
      antigravityTools: { apiKey: "sk-old", adminPassword: "old" },
    });
    expect(payload.antigravityTools).toEqual({
      enabled: true,
      usageHours: 168,
      includeUsage: true,
      baseUrl: "http://127.0.0.1:8045",
      apiKey: "",
      adminPassword: "",
    });
  });

  it("writes exact scalar sections for output and polling", () => {
    const draft = { ...baseline, sort: "reset" as const, watchIntervalSec: 120 };
    expect(sectionPayload("output", draft, {})).toEqual({
      sort: "reset",
      summary: true,
      trend: "compact",
    });
    expect(sectionPayload("polling", draft, {})).toMatchObject({ watchIntervalSec: 120 });
  });
});

describe("sectionProblems", () => {
  const baseline = draftFromConfig({});

  it("rejects watchIntervalSec below the 5s TUI clamp bound", () => {
    const draft = { ...baseline, watchIntervalSec: WATCH_INTERVAL_MIN - 2 };
    expect(sectionProblems("polling", draft)).toHaveLength(1);
    expect(sectionProblems("polling", { ...baseline, watchIntervalSec: WATCH_INTERVAL_MIN })).toEqual([]);
  });

  it("rejects uiRefreshSec below 1 and negative counters", () => {
    expect(sectionProblems("polling", { ...baseline, uiRefreshSec: 0 })).toHaveLength(1);
    expect(sectionProblems("polling", { ...baseline, cacheTtlSec: -1 })).toHaveLength(1);
  });

  it("flags malformed exclude emails", () => {
    const draft = { ...baseline, excludeEmails: ["ok@example.com", "nope"] };
    const problems = sectionProblems("google", draft);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("nope");
  });

  it("requires a positive antigravity usage window", () => {
    expect(sectionProblems("antigravity", { ...baseline, agtUsageHours: 0 })).toHaveLength(1);
  });
});

describe("dirty tracking and list helpers", () => {
  const baseline = draftFromConfig({ providers: { disabled: ["xai"] } });

  it("detects per-section changes without cross-talk", () => {
    const changed = { ...baseline, sort: "name" as const };
    expect(isSectionDirty("output", changed, baseline)).toBe(true);
    expect(isSectionDirty("polling", changed, baseline)).toBe(false);
    expect(isSectionDirty("providers", changed, baseline)).toBe(false);
  });

  it("toggles a provider id in and out of disabled", () => {
    const disabled = toggleDisabled(baseline.disabled, "poe");
    expect(disabled).toEqual(["xai", "poe"]);
    expect(toggleDisabled(disabled, "xai")).toEqual(["poe"]);
  });

  it("moves order items within bounds only", () => {
    const order = ["a", "b", "c"];
    expect(moveOrderItem(order, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveOrderItem(order, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveOrderItem(order, "a", -1)).toEqual(order);
    expect(moveOrderItem(order, "c", 1)).toEqual(order);
  });

  it("tracks desktop prefs dirtiness per field", () => {
    const prefsBaseline = prefsDraftFrom({
      threshold: 25,
      trendMode: undefined,
      notifications: true,
      notifyCooldownMin: 60,
      lastTab: undefined,
      windowBounds: undefined,
      launchAtLogin: false,
    });
    expect(isPrefsDirty(prefsBaseline, prefsBaseline)).toBe(false);
    expect(isPrefsDirty({ ...prefsBaseline, threshold: 30 }, prefsBaseline)).toBe(true);
    expect(prefsProblems({ ...prefsBaseline, notifyCooldownMin: 0 })).toHaveLength(1);
  });
});
