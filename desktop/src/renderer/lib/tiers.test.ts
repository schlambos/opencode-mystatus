import { describe, expect, it } from "vitest";
import type { MyStatusViewProvider, MyStatusViewWindow } from "../../shared/ipc";
import { groupsForHorizon, windowTier, windowsForView } from "./tiers";

// ── Golden fixture table ────────────────────────────────────────────────────
// PARITY: plugin/tui.ts:304-402 — hand-derived line by line; re-verify if the
// TUI changes. Expected values below are computed from the TUI source, not
// from the vendored implementation:
//
//   tui.ts:307      monthly  ← /\bmonthly\b/ or /\b30[\s-]?day\b/
//   tui.ts:308      weekly   ← /\bweekly\b/ or /\b7[\s-]?day\b/ or /\bweek\b/
//   tui.ts:309-311  monthly  ← /\bcredits?\b/ or /\bbalance\b/ or /\bpoints\b/ or /\btotal\b/
//   tui.ts:312-324  short    ← 5-hour/5h/session/daily/hour/rolling/premium/chat/completions
//   tui.ts:326-331  resetMs fallback: ≤8h short, ≤240h weekly, else monthly
//   tui.ts:333      default  ← short
//
// Rule order matters: the monthly line runs before the credits line, and the
// credits/balance/points/total line runs BEFORE the short keywords — so
// "session credits" is monthly, and "monthly ai credits" matches the monthly
// keyword first.

const H = 3_600_000;
const D = 24 * H;

describe("windowTier — golden table derived from plugin/tui.ts:304-334", () => {
  const cases: Array<{
    label: string;
    resetMs?: number | undefined;
    expect: "short" | "weekly" | "monthly";
    why: string;
  }> = [
    // monthly keyword branch (tui.ts:307)
    { label: "Monthly plan total", expect: "monthly", why: "307: \\bmonthly\\b (checked before 'total' on 309)" },
    { label: "30-day limit", expect: "monthly", why: "307: \\b30[\\s-]?day\\b with hyphen" },
    { label: "30 day cycle", expect: "monthly", why: "307: \\b30[\\s-]?day\\b with space" },
    // weekly keyword branch (tui.ts:308)
    { label: "Weekly plan cap", expect: "weekly", why: "308: \\bweekly\\b" },
    { label: "7-day limit", expect: "weekly", why: "308: \\b7[\\s-]?day\\b" },
    { label: "Usage this week", expect: "weekly", why: "308: \\bweek\\b" },
    // credits/balance/points/total branch (tui.ts:309-311)
    { label: "Plan points", expect: "monthly", why: "309: \\bpoints\\b" },
    { label: "Extra usage balance", expect: "monthly", why: "309: \\bbalance\\b" },
    { label: "Total tokens", expect: "monthly", why: "309: \\btotal\\b" },
    { label: "Credits", expect: "monthly", why: "309: \\bcredits?\\b (plural)" },
    { label: "Monthly AI credits", expect: "monthly", why: "307 beats 309: monthly keyword checked first" },
    { label: "Session credits", expect: "monthly", why: "309 beats 312-324: credits line runs BEFORE short keywords" },
    // short keyword branch (tui.ts:312-324)
    { label: "5-hour limit", expect: "short", why: "313: \\b5[\\s-]?h(our|\\b)" },
    { label: "5h rolling", expect: "short", why: "314: \\b5h\\b" },
    { label: "Session", expect: "short", why: "315: \\bsession\\b" },
    { label: "Daily images", expect: "short", why: "316: \\bdaily\\b" },
    { label: "1-hour window", expect: "short", why: "317: \\bhour\\b" },
    { label: "Rolling", expect: "short", why: "318: \\brolling\\b" },
    { label: "Premium requests", expect: "short", why: "319: \\bpremium\\b" },
    { label: "Chat messages", expect: "short", why: "320: \\bchat\\b" },
    { label: "Code completions", expect: "short", why: "321: \\bcompletions\\b" },
    { label: "Weekly completions", expect: "weekly", why: "308 beats 321: weekly line runs before short keywords" },
    // label matching is case-insensitive (tui.ts:305 lowercases first)
    { label: "SESSION LIMIT", expect: "short", why: "305: toLowerCase before matching" },
    { label: "MONTHLY", expect: "monthly", why: "305: toLowerCase before matching" },
    // word-boundary traps: no keyword match, so the fallback decides
    { label: "Biweekly reset", expect: "short", why: "no \\bweekly\\b/\\bweek\\b boundary inside 'biweekly' → default 333" },
    { label: "7 days", expect: "short", why: "\\b7[\\s-]?day\\b fails on 'days' (no boundary before s) → default 333" },
    // resetMs fallback (tui.ts:326-331) — no keyword in the label
    { label: "Quota pool", resetMs: 2 * H, expect: "short", why: "328: h=2 ≤ 8" },
    { label: "Quota pool", resetMs: 8 * H, expect: "short", why: "328: h=8 ≤ 8 (inclusive boundary)" },
    { label: "Quota pool", resetMs: 8 * H + 1, expect: "weekly", why: "329: h>8, ≤ 240" },
    { label: "Quota pool", resetMs: 10 * D, expect: "weekly", why: "329: h=240 ≤ 24*10 (inclusive boundary)" },
    { label: "Quota pool", resetMs: 10 * D + H, expect: "monthly", why: "330: h>240" },
    { label: "Quota pool", resetMs: 0, expect: "short", why: "326-328: 0 is finite, h=0 ≤ 8" },
    { label: "Quota pool", resetMs: Number.POSITIVE_INFINITY, expect: "short", why: "326: !Number.isFinite → skips fallback → default 333" },
    { label: "Quota pool", resetMs: Number.NaN, expect: "short", why: "326: !Number.isFinite → skips fallback → default 333" },
    { label: "Quota pool", expect: "short", why: "333: no keyword, no resetMs → short" },
    { label: "Quota pool", resetMs: undefined, expect: "short", why: "333: explicit undefined behaves like absent" },
  ];

  for (const [i, c] of cases.entries()) {
    it(`#${String(i + 1).padStart(2, "0")} "${c.label}"${c.resetMs === undefined ? "" : ` resetMs=${String(c.resetMs)}`} → ${c.expect} (${c.why})`, () => {
      expect(windowTier(c.label, c.resetMs)).toBe(c.expect);
    });
  }
});

// ── windowsForView — parity with plugin/tui.ts:358-370 ──────────────────────

function w(label: string, remaining: number, resetMs?: number): MyStatusViewWindow {
  return resetMs === undefined ? { label, remaining } : { label, remaining, resetMs };
}

describe("windowsForView — golden cases derived from plugin/tui.ts:358-370", () => {
  const multi = [w("5-hour limit", 49, 70 * 60_000), w("7-day limit", 72, 4 * D), w("Monthly plan total", 84, 29 * D)];

  it("current shows only short windows when present (361-362)", () => {
    expect(windowsForView(multi, "current").map((x) => x.label)).toEqual(["5-hour limit"]);
  });

  it("weekly shows every weekly window (365-366)", () => {
    expect(windowsForView(multi, "weekly").map((x) => x.label)).toEqual(["7-day limit"]);
  });

  it("monthly shows monthly windows for multi-tier providers (367-368)", () => {
    expect(windowsForView(multi, "monthly").map((x) => x.label)).toEqual(["Monthly plan total"]);
  });

  it("current falls back short → weekly → monthly (361-364)", () => {
    const weeklyOnly = [w("Weekly SuperGrok limit", 22, 6 * D)];
    expect(windowsForView(weeklyOnly, "current").map((x) => x.label)).toEqual(["Weekly SuperGrok limit"]);
    const monthlyOnly = [w("Plan points", 46, 11 * D)];
    expect(windowsForView(monthlyOnly, "current").map((x) => x.label)).toEqual(["Plan points"]);
  });

  it("weekly-only providers also appear on weekly (365-366)", () => {
    const weeklyOnly = [w("Weekly SuperGrok limit", 22, 6 * D)];
    expect(windowsForView(weeklyOnly, "weekly").map((x) => x.label)).toEqual(["Weekly SuperGrok limit"]);
  });

  it("monthly tab EXCLUDES monthly-only providers (368: needs a shorter tier)", () => {
    const monthlyOnly = [w("Plan points", 46, 11 * D), w("Add-on credits", 90)];
    expect(windowsForView(monthlyOnly, "monthly")).toEqual([]);
    expect(windowsForView(monthlyOnly, "weekly")).toEqual([]);
  });

  it("short + monthly (no weekly): monthly tab still qualifies via the short tier (368)", () => {
    const shortAndMonthly = [w("Session", 95, 2 * H), w("Total balance", 71, 21 * D)];
    expect(windowsForView(shortAndMonthly, "weekly")).toEqual([]);
    expect(windowsForView(shortAndMonthly, "monthly").map((x) => x.label)).toEqual(["Total balance"]);
  });

  it("zero windows stay zero in every view", () => {
    expect(windowsForView([], "current")).toEqual([]);
    expect(windowsForView([], "weekly")).toEqual([]);
    expect(windowsForView([], "monthly")).toEqual([]);
  });
});

// ── groupsForHorizon — ordering parity with plugin/tui.ts:374-402 ───────────

function provider(name: string, windows: MyStatusViewWindow[], extra?: Partial<MyStatusViewProvider>): MyStatusViewProvider {
  return { name, minRemaining: Math.min(...windows.map((x) => x.remaining), 100), windows, ...extra };
}

describe("groupsForHorizon — ordering derived from plugin/tui.ts:374-402", () => {
  it("sorts groups by worst remaining asc, then soonest reset asc (398-401)", () => {
    const a = provider("A", [w("5-hour", 3, 60 * 60_000)]); // worst 3, soonest 1h
    const b = provider("B", [w("5-hour", 3, 30 * 60_000)]); // worst 3, soonest 30m → first
    const c = provider("C", [w("5-hour", 50, 10 * 60_000)]); // worst 50 → last
    const names = groupsForHorizon([a, b, c], "current").map((g) => g.provider.name);
    expect(names).toEqual(["B", "A", "C"]);
  });

  it("drops providers with no windows in the view (377-378)", () => {
    const monthlyOnly = provider("Poe-ish", [w("Plan points", 46, 11 * D)]);
    const hasWeekly = provider("Grok-ish", [w("Weekly pool", 22, 6 * D)]);
    const groups = groupsForHorizon([monthlyOnly, hasWeekly], "weekly");
    expect(groups.map((g) => g.provider.name)).toEqual(["Grok-ish"]);
  });

  it("sorts windows within a group by remaining asc, then resetMs asc with undefined last (379-382)", () => {
    const p = provider("Multi", [
      w("Session", 80, 5 * H),
      w("5-hour", 40), // undefined resetMs → Infinity → last among equals
      w("5-hour burst", 40, 2 * H),
      w("Daily", 10, 9 * H),
    ]);
    const [group] = groupsForHorizon([p], "current");
    expect(group?.windows.map((x) => x.label)).toEqual(["Daily", "5-hour burst", "5-hour", "Session"]);
  });

  it("computes worst as the min remaining across the view's windows (393)", () => {
    const p = provider("P", [w("5-hour", 12, H), w("Session", 77, 2 * H)]);
    const [group] = groupsForHorizon([p], "current");
    expect(group?.worst).toBe(12);
  });

  it("soonest ignores non-positive resetMs (383-386)", () => {
    const p = provider("P", [w("5-hour", 50, 0), w("Session", 60, 3 * H)]);
    const [group] = groupsForHorizon([p], "current");
    expect(group?.soonest).toBe(3 * H);
    const resetting = provider("Q", [w("5-hour", 50, 0)]);
    const [q] = groupsForHorizon([resetting], "current");
    expect(q?.soonest).toBeUndefined();
  });

  it("an absent soonest sorts after any real one (400: ?? Infinity)", () => {
    const noReset = provider("NoReset", [w("5-hour", 5)]); // worst 5, soonest undefined
    const lateReset = provider("LateReset", [w("5-hour", 5, 9 * D)]); // worst 5, soonest 9d
    const names = groupsForHorizon([noReset, lateReset], "current").map((g) => g.provider.name);
    expect(names).toEqual(["LateReset", "NoReset"]);
  });

  it("uses the view-filtered windows for ordering, not the full window list", () => {
    // Monthly window at 1% must NOT drag this provider to the top of Current.
    const p = provider("P", [w("5-hour", 88, H), w("Monthly plan total", 1, 25 * D)]);
    const q = provider("Q", [w("5-hour", 40, 2 * H)]);
    const groups = groupsForHorizon([p, q], "current");
    expect(groups.map((g) => g.provider.name)).toEqual(["Q", "P"]);
    expect(groups.map((g) => g.worst)).toEqual([40, 88]);
  });
});
