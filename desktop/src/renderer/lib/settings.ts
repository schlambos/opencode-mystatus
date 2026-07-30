// Pure form logic for the Settings page (todo 14).
//
// Invariant: `providers` and `antigravityTools` payloads are ALWAYS fully
// formed — the core's saveConfig shallow-merges top level, and main's
// saveSettingsSections rejects partial providers payloads. The draft spreads
// the on-disk `providers.hidden` into every save because the Settings page
// never edits hidden state (that belongs to the dashboard hide/show flow).

import type { DesktopPrefs, MyStatusConfig, TrendMode } from "../../shared/ipc.js";
import type { SortMode } from "./controls.js";

export type SettingsSectionKind = "output" | "polling" | "providers" | "google" | "antigravity";

export const SETTINGS_SECTIONS: readonly SettingsSectionKind[] = [
  "output",
  "polling",
  "providers",
  "google",
  "antigravity",
];

export interface SettingsDraft {
  sort: SortMode;
  summary: boolean;
  trend: TrendMode;
  cacheTtlSec: number;
  historyMax: number;
  historyMinIntervalSec: number;
  watchIntervalSec: number;
  uiRefreshSec: number;
  disabled: string[];
  order: string[];
  excludeEmails: string[];
  agtEnabled: boolean;
  agtUsageHours: number;
  agtIncludeUsage: boolean;
  agtBaseUrl: string;
  agtApiKey: string;
  agtAdminPassword: string;
}

export const WATCH_INTERVAL_MIN = 5;
export const UI_REFRESH_MIN = 1;

function toSort(value: unknown): SortMode {
  return value === "name" || value === "reset" ? value : "urgency";
}

function toTrend(value: unknown): TrendMode {
  return value === "off" || value === "full" ? value : "compact";
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringArray(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function draftFromConfig(config: MyStatusConfig): SettingsDraft {
  const agt = config.antigravityTools ?? {};
  return {
    sort: toSort(config.sort),
    summary: typeof config.summary === "boolean" ? config.summary : true,
    trend: toTrend(config.trend),
    cacheTtlSec: toNumber(config.cacheTtlSec, 0),
    historyMax: toNumber(config.historyMax, 60),
    historyMinIntervalSec: toNumber(config.historyMinIntervalSec, 60),
    watchIntervalSec: toNumber(config.watchIntervalSec, 60),
    uiRefreshSec: toNumber(config.uiRefreshSec, 1),
    disabled: toStringArray(config.providers?.disabled),
    order: toStringArray(config.providers?.order),
    excludeEmails: toStringArray(config.google?.excludeEmails),
    agtEnabled: typeof agt.enabled === "boolean" ? agt.enabled : true,
    agtUsageHours: toNumber(agt.usageHours, 168),
    agtIncludeUsage: typeof agt.includeUsage === "boolean" ? agt.includeUsage : true,
    agtBaseUrl: typeof agt.baseUrl === "string" ? agt.baseUrl : "",
    agtApiKey: typeof agt.apiKey === "string" ? agt.apiKey : "",
    agtAdminPassword: typeof agt.adminPassword === "string" ? agt.adminPassword : "",
  };
}

/**
 * Build the save payload for one section. `onDisk` must be a FRESH read —
 * the page re-inspects before every save. providers spreads the on-disk
 * `hidden` (never edited here); antigravityTools always carries all six keys
 * so clearing a secret writes an empty string instead of keeping the old one.
 */
export function sectionPayload(
  kind: SettingsSectionKind,
  draft: SettingsDraft,
  onDisk: MyStatusConfig,
): Partial<MyStatusConfig> {
  switch (kind) {
    case "output":
      return { sort: draft.sort, summary: draft.summary, trend: draft.trend };
    case "polling":
      return {
        cacheTtlSec: draft.cacheTtlSec,
        historyMax: draft.historyMax,
        historyMinIntervalSec: draft.historyMinIntervalSec,
        watchIntervalSec: draft.watchIntervalSec,
        uiRefreshSec: draft.uiRefreshSec,
      };
    case "providers": {
      const providers: NonNullable<MyStatusConfig["providers"]> = {
        disabled: [...draft.disabled],
        order: [...draft.order],
      };
      const hidden = onDisk.providers?.hidden;
      if (hidden !== undefined) providers.hidden = [...hidden];
      return { providers };
    }
    case "google":
      return { google: { excludeEmails: [...draft.excludeEmails] } };
    case "antigravity":
      return {
        antigravityTools: {
          enabled: draft.agtEnabled,
          usageHours: draft.agtUsageHours,
          includeUsage: draft.agtIncludeUsage,
          baseUrl: draft.agtBaseUrl,
          apiKey: draft.agtApiKey,
          adminPassword: draft.agtAdminPassword,
        },
      };
    default: {
      const unreachable: never = kind;
      throw new Error(`unknown settings section: ${String(unreachable)}`);
    }
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sectionProblems(kind: SettingsSectionKind, draft: SettingsDraft): string[] {
  const problems: string[] = [];
  if (kind === "polling") {
    if (draft.watchIntervalSec < WATCH_INTERVAL_MIN) {
      problems.push(`Provider sync interval must be at least ${WATCH_INTERVAL_MIN}s`);
    }
    if (draft.uiRefreshSec < UI_REFRESH_MIN) {
      problems.push(`UI refresh must be at least ${UI_REFRESH_MIN}s`);
    }
    if (draft.cacheTtlSec < 0) problems.push("Cache TTL cannot be negative");
    if (draft.historyMax < 0) problems.push("History size cannot be negative");
    if (draft.historyMinIntervalSec < 0) problems.push("History interval cannot be negative");
  }
  if (kind === "google") {
    for (const email of draft.excludeEmails) {
      if (!EMAIL_PATTERN.test(email)) problems.push(`"${email}" is not a valid address`);
    }
  }
  if (kind === "antigravity" && draft.agtUsageHours < 1) {
    problems.push("Usage window must be at least 1 hour");
  }
  return problems;
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function isSectionDirty(
  kind: SettingsSectionKind,
  draft: SettingsDraft,
  baseline: SettingsDraft,
): boolean {
  switch (kind) {
    case "output":
      return draft.sort !== baseline.sort || draft.summary !== baseline.summary || draft.trend !== baseline.trend;
    case "polling":
      return (
        draft.cacheTtlSec !== baseline.cacheTtlSec ||
        draft.historyMax !== baseline.historyMax ||
        draft.historyMinIntervalSec !== baseline.historyMinIntervalSec ||
        draft.watchIntervalSec !== baseline.watchIntervalSec ||
        draft.uiRefreshSec !== baseline.uiRefreshSec
      );
    case "providers":
      return !sameArray(draft.disabled, baseline.disabled) || !sameArray(draft.order, baseline.order);
    case "google":
      return !sameArray(draft.excludeEmails, baseline.excludeEmails);
    case "antigravity":
      return (
        draft.agtEnabled !== baseline.agtEnabled ||
        draft.agtUsageHours !== baseline.agtUsageHours ||
        draft.agtIncludeUsage !== baseline.agtIncludeUsage ||
        draft.agtBaseUrl !== baseline.agtBaseUrl ||
        draft.agtApiKey !== baseline.agtApiKey ||
        draft.agtAdminPassword !== baseline.agtAdminPassword
      );
    default: {
      const unreachable: never = kind;
      throw new Error(`unknown settings section: ${String(unreachable)}`);
    }
  }
}

export function toggleDisabled(disabled: readonly string[], id: string): string[] {
  return disabled.includes(id) ? disabled.filter((entry) => entry !== id) : [...disabled, id];
}

export function moveOrderItem(order: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  const moved = next[index];
  const displaced = next[target];
  if (moved === undefined || displaced === undefined) return next;
  next[index] = displaced;
  next[target] = moved;
  return next;
}

export interface DesktopPrefsDraft {
  threshold: number;
  notifications: boolean;
  notifyCooldownMin: number;
  launchAtLogin: boolean;
}

export function prefsDraftFrom(prefs: DesktopPrefs): DesktopPrefsDraft {
  return {
    threshold: prefs.threshold,
    notifications: prefs.notifications,
    notifyCooldownMin: prefs.notifyCooldownMin,
    launchAtLogin: prefs.launchAtLogin,
  };
}

export function prefsProblems(draft: DesktopPrefsDraft): string[] {
  const problems: string[] = [];
  if (draft.notifyCooldownMin < 1) problems.push("Notification cooldown must be at least 1 minute");
  return problems;
}

export function isPrefsDirty(draft: DesktopPrefsDraft, baseline: DesktopPrefsDraft): boolean {
  return (
    draft.threshold !== baseline.threshold ||
    draft.notifications !== baseline.notifications ||
    draft.notifyCooldownMin !== baseline.notifyCooldownMin ||
    draft.launchAtLogin !== baseline.launchAtLogin
  );
}
