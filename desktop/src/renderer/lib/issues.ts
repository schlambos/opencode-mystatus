// Issue classification + sub-account collapse for the Issues panel.
//
// PARITY: plugin/tui.ts:205-248 (shortProvider/compactNames/commonPrefix/
// dedupePrefix), 512-536 (groupIssueRows), 538-563 (buildIssueBody) — re-verify
// if the TUI changes. These helpers are module-private in tui.ts and the plan
// forbids editing the core, so they are re-implemented here and locked by the
// golden tests in issues.test.ts (known drift risk — see README, todo 19).
//
// The core already orders model.issues error → stale → unconfigured
// (plugin/mystatus.ts:7228-7257); the grouping below preserves that order via
// Map insertion order.

import type { StatusIssue } from "../../shared/ipc.js";
import { formatDuration } from "./status.js";

/** Strip the boilerplate suffix the core appends to provider titles. */
export function shortProvider(name: string): string {
  const trimmed = name
    .replace(/ Account Quota$/i, "")
    .replace(/ Coding Plan$/i, "")
    .replace(/ Token Plan$/i, "")
    .replace(/ Cloud$/i, "")
    .replace(/ Usage$/i, "")
    .replace(/ Quota$/i, "");
  const split = trimmed.split(" \u2014 ");
  const [first, second] = split;
  if (
    split.length === 2 &&
    first !== undefined &&
    second !== undefined &&
    first.toLowerCase().includes(second.toLowerCase())
  ) {
    return first;
  }
  return trimmed;
}

/** `Google — a@gmail.com` → `Google — a`, kept only while it stays unambiguous. */
export function compactNames(names: string[]): string[] {
  const shortened = names.map((n) => n.replace(/([\w.+-]+)@[\w.-]+/g, "$1"));
  const seen = new Map<string, number>();
  for (const n of shortened) seen.set(n, (seen.get(n) ?? 0) + 1);
  return names.map((n, i) => {
    const short = shortened[i];
    return short !== undefined && (seen.get(short) ?? 0) === 1 ? short : n;
  });
}

export function commonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0] ?? "";
  for (const v of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < v.length && prefix[i] === v[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix.replace(/[\s\u2014\u00b7,-]+$/, "");
}

/** Providers often wrap their own name around a nested error: `X: X failed`. */
export function dedupePrefix(detail: string): string {
  return detail.replace(/^(.{3,40}?):\s*\1/i, "$1");
}

export interface IssueGroup {
  kind: "error" | "stale";
  /** Collapsed display label, e.g. "Google (4 accounts)". */
  provider: string;
  /** "failed", or "stale 16h" for stale data. */
  status: string;
  detail: string;
  ageMs: number;
  /** Compacted provider names folded into this group. */
  providers: string[];
}

/**
 * Collapse error + stale issues that share kind, de-duplicated detail, and
 * age-rounded-to-the-minute into one row — mirroring the TUI's Issues pane
 * (plugin/tui.ts:512-536). Unconfigured issues are NOT attention issues and are
 * excluded here (rendered separately as a compact list via unconfiguredNames).
 */
export function groupAttentionIssues(issues: StatusIssue[]): IssueGroup[] {
  const attention = issues.filter((i) => i.kind !== "unconfigured");
  const names = compactNames(attention.map((i) => shortProvider(i.provider)));

  const buckets = new Map<string, { issue: StatusIssue; names: string[] }>();
  attention.forEach((issue, i) => {
    const detail = dedupePrefix(issue.detail);
    const key = `${issue.kind}|${detail}|${Math.round((issue.ageMs ?? 0) / 60_000)}`;
    const name = names[i] ?? issue.provider;
    const bucket = buckets.get(key);
    if (bucket) bucket.names.push(name);
    else buckets.set(key, { issue, names: [name] });
  });

  const groups: IssueGroup[] = [];
  for (const { issue, names: group } of buckets.values()) {
    const stale = issue.kind === "stale";
    const first = group[0] ?? "";
    const label = group.length > 1 ? `${commonPrefix(group) || first} (${group.length} accounts)` : first;
    groups.push({
      kind: stale ? "stale" : "error",
      provider: label,
      status: stale ? `stale ${formatDuration(Math.floor((issue.ageMs ?? 0) / 1000))}` : "failed",
      detail: dedupePrefix(issue.detail),
      ageMs: issue.ageMs ?? 0,
      providers: group,
    });
  }
  return groups;
}

/** Comma-joined, compacted names of the not-configured providers. */
export function unconfiguredNames(issues: StatusIssue[]): string {
  const idle = issues.filter((i) => i.kind === "unconfigured");
  return compactNames(idle.map((i) => shortProvider(i.provider))).join(", ");
}

// Providers whose credentials come from a captured browser session (the
// "Sign in" flow on the Credentials page), not auth.json. Keyword match on the
// provider title keeps this robust to the core's `... Quota`/`... Plan` suffixes.
const COOKIE_KEYWORDS = [
  "atlas",
  "byteplus",
  "mistral",
  "ollama",
  "longcat",
  "qwen",
  "stepfun",
  "opencode go",
  "opencode-go",
  "go+zen",
];

/** True when the issue belongs to a browser-session (cookie) provider. */
export function isCookieProvider(provider: string): boolean {
  const lower = provider.toLowerCase();
  return COOKIE_KEYWORDS.some((k) => lower.includes(k));
}
