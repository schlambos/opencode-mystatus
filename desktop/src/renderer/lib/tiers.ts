// Window-tier classification for the horizon tabs (Current / Weekly / Monthly).
//
// PARITY: plugin/tui.ts:304-402 — re-verify if the TUI changes.
// The TUI keeps windowTier/splitTiers/windowsForView/groupsForView module-
// private (plugin/tui.ts exports only runMyStatusTui) and the plan forbids
// editing the core, so the desktop app vendors an exact re-implementation.
// The golden fixture table in tiers.test.ts is hand-derived line by line from
// tui.ts:304-334 (windowTier), 336-351 (splitTiers), 358-370 (windowsForView)
// and 374-402 (groupsForView) — known drift risk, see README (todo 19).
//
// Deliberate omission vs. the TUI: display-only name shortening
// (shortProvider/dropEmailDomains/shortNote — tui.ts:205-231, 267-270) is a
// terminal-width concern; the desktop renders full provider names and notes.
// Tier semantics and group ordering are unchanged.

import type { MyStatusViewProvider, MyStatusViewWindow } from "../../shared/ipc";

export type Tier = "short" | "weekly" | "monthly";
export type Horizon = "current" | "weekly" | "monthly";

// PARITY: plugin/tui.ts:304-334 — rule order is load-bearing (monthly keyword
// before credits keywords, credits keywords before short keywords).
export function windowTier(label: string, resetMs?: number): Tier {
  const l = label.toLowerCase();

  if (/\bmonthly\b/.test(l) || /\b30[\s-]?day\b/.test(l)) return "monthly";
  if (/\bweekly\b/.test(l) || /\b7[\s-]?day\b/.test(l) || /\bweek\b/.test(l)) return "weekly";
  if (/\bcredits?\b/.test(l) || /\bbalance\b/.test(l) || /\bpoints\b/.test(l) || /\btotal\b/.test(l)) {
    return "monthly";
  }
  if (
    /\b5[\s-]?h(our|\b)/.test(l) ||
    /\b5h\b/.test(l) ||
    /\bsession\b/.test(l) ||
    /\bdaily\b/.test(l) ||
    /\bhour\b/.test(l) ||
    /\brolling\b/.test(l) ||
    /\bpremium\b/.test(l) ||
    /\bchat\b/.test(l) ||
    /\bcompletions\b/.test(l)
  ) {
    return "short";
  }

  if (resetMs !== undefined && Number.isFinite(resetMs)) {
    const h = resetMs / 3_600_000;
    if (h <= 8) return "short";
    if (h <= 24 * 10) return "weekly";
    return "monthly";
  }

  return "short";
}

// PARITY: plugin/tui.ts:336-351 (splitTiers).
function splitTiers(windows: MyStatusViewWindow[]): {
  short: MyStatusViewWindow[];
  weekly: MyStatusViewWindow[];
  monthly: MyStatusViewWindow[];
} {
  const short: MyStatusViewWindow[] = [];
  const weekly: MyStatusViewWindow[] = [];
  const monthly: MyStatusViewWindow[] = [];
  for (const w of windows) {
    const t = windowTier(w.label, w.resetMs);
    if (t === "short") short.push(w);
    else if (t === "weekly") weekly.push(w);
    else monthly.push(w);
  }
  return { short, weekly, monthly };
}

/**
 * PARITY: plugin/tui.ts:353-370.
 * Current  = actionable quota now (short-term, or best available if that's all they have).
 * Weekly   = every 7-day/weekly window, including weekly-only providers.
 * Monthly  = billing-cycle windows only when the provider also has shorter tiers.
 */
export function windowsForView(windows: MyStatusViewWindow[], view: Horizon): MyStatusViewWindow[] {
  const { short, weekly, monthly } = splitTiers(windows);
  switch (view) {
    case "current":
      if (short.length > 0) return short;
      if (weekly.length > 0) return weekly;
      return monthly;
    case "weekly":
      return weekly;
    case "monthly":
      return short.length > 0 || weekly.length > 0 ? monthly : [];
  }
}

export interface HorizonGroup {
  provider: MyStatusViewProvider;
  /** View-filtered windows, sorted remaining asc then resetMs asc (undefined last). */
  windows: MyStatusViewWindow[];
  /** Min remaining across the view's windows (tui.ts:393). */
  worst: number;
  /** Smallest positive resetMs across the view's windows; undefined when none (tui.ts:383-386). */
  soonest: number | undefined;
}

// PARITY: plugin/tui.ts:374-402 (groupsForView) minus the terminal-width name
// shortening — the desktop keeps provider names verbatim. Hidden-provider
// filtering happens at the call site (tui.ts:659 does the same in buildFrame).
export function groupsForHorizon(providers: MyStatusViewProvider[], horizon: Horizon): HorizonGroup[] {
  const groups: HorizonGroup[] = [];
  for (const p of providers) {
    const windows = windowsForView(p.windows, horizon);
    if (windows.length === 0) continue;
    const sorted = [...windows].sort((a, b) => {
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return (a.resetMs ?? Infinity) - (b.resetMs ?? Infinity);
    });
    const soonest = sorted.reduce<number | undefined>((s, w) => {
      if (typeof w.resetMs !== "number" || w.resetMs <= 0) return s;
      return s === undefined || w.resetMs < s ? w.resetMs : s;
    }, undefined);
    groups.push({
      provider: p,
      windows: sorted,
      worst: Math.min(...sorted.map((w) => w.remaining)),
      soonest,
    });
  }
  return groups.sort((a, b) => {
    if (a.worst !== b.worst) return a.worst - b.worst;
    return (a.soonest ?? Infinity) - (b.soonest ?? Infinity);
  });
}
