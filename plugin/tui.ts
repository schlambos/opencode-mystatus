/**
 * Live TUI — single-pane usage board with Current / Weekly / Monthly views.
 * One-shot CLI / OpenCode tool output is unchanged.
 *
 * Painting is differential: a frame is an array of screen rows, and only rows
 * whose content changed are rewritten (cursor address + erase-to-end-of-line).
 * A full clear happens on resize only, so countdown ticks never flash.
 */

import {
  buildMyStatusViewModel,
  loadConfig,
  queryMyStatus,
  saveConfig,
  type MyStatusArgs,
  type MyStatusSnapshot,
  type MyStatusViewModel,
  type MyStatusViewWindow,
  type StatusIssue,
} from "./mystatus";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";
const EL = "\x1b[K";
const ED = "\x1b[J";

const RULE = "\u2500";
const RESET_MARK = "\u21bb";
const SEP = `${DIM}  \u00b7  ${R}`;

/** Header rows (title, tabs, rule) + footer rows (rule, keys). */
const CHROME_H = 5;

type Horizon = "current" | "weekly" | "monthly";
type Density = "auto" | "detail" | "compact";
type Pane = "quota" | "issues" | "hidden";

const VIEWS: { id: Horizon; key: string; title: string; hint: string }[] = [
  { id: "current", key: "1", title: "Current", hint: "what you have left now" },
  { id: "weekly", key: "2", title: "Weekly", hint: "7-day / weekly limits" },
  { id: "monthly", key: "3", title: "Monthly", hint: "monthly / credits (multi-tier only)" },
];

const DENSITIES: Density[] = ["auto", "detail", "compact"];

export interface MyStatusTuiOptions {
  args: MyStatusArgs;
  intervalSec?: number;
}

type BodyLine =
  | { kind: "text"; text: string }
  | { kind: "header"; name: string; note?: string; badge?: string; source: string }
  | {
      kind: "row";
      label: string;
      remaining: number;
      resetMs?: number;
      indent: number;
      badge?: string;
      suffix?: string;
      source: string;
    }
  | { kind: "issue"; marker: string; color: string; provider: string; status: string; detail?: string }
  | { kind: "hidden-row"; name: string; source: string };

interface Group {
  name: string;
  /** Untouched provider title, used to strip redundant text out of window labels. */
  source: string;
  note?: string;
  stale?: { ageMs: number; reason?: string };
  windows: MyStatusViewWindow[];
  worst: number;
  soonest?: number;
}

interface Layout {
  W: number;
  labelW: number;
  barW: number;
  indentW: number;
  provW: number;
  statusW: number;
}

// ── text helpers ──────────────────────────────────────────────

function strip(s: string): string {
  return s.replace(ANSI_RE, "");
}

function dw(s: string): number {
  let w = 0;
  for (const cp of s) {
    const c = cp.codePointAt(0) ?? 0;
    if ((c >= 0x1f300 && c <= 0x1f9ff) || (c >= 0x2600 && c <= 0x27bf) || (c >= 0x4e00 && c <= 0xa4ff)) w += 2;
    else w += 1;
  }
  return w;
}

/** Truncate to a visible width, preserving (and closing) ANSI sequences. */
function clip(s: string, w: number): string {
  if (w <= 0) return "";
  if (dw(strip(s)) <= w) return s;
  let out = "";
  let acc = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = String.fromCodePoint(s.codePointAt(i) ?? 32);
    const cw = dw(cp);
    if (acc + cw > w - 1) break;
    out += cp;
    acc += cw;
    i += cp.length;
  }
  return `${out}\u2026${R}`;
}

function padR(s: string, w: number): string {
  const v = dw(strip(s));
  return v >= w ? clip(s, w) : s + " ".repeat(w - v);
}

function padL(s: string, w: number): string {
  const v = dw(strip(s));
  return v >= w ? clip(s, w) : " ".repeat(w - v) + s;
}

function joinLR(left: string, right: string, W: number): string {
  if (!strip(right)) return clip(left, W);
  const gap = W - dw(strip(left)) - dw(strip(right));
  if (gap < 1) return clip(left, W);
  return left + " ".repeat(gap) + right;
}

function term(): { cols: number; rows: number } {
  return { cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
}

/** A read can carry several keypresses at once; split them so none are dropped. */
function keyTokens(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(s.slice(i));
      if (m) {
        out.push(m[0]);
        i += m[0].length;
        continue;
      }
    }
    out.push(s[i]);
    i++;
  }
  return out;
}

function fmtDur(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function fmtAge(sec: number): string {
  return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;
}

function pctColor(p: number, threshold: number): string {
  if (p < threshold) return RED;
  if (p < 50) return YEL;
  return GRN;
}

function bar(p: number, w: number, threshold: number): string {
  const n = Math.max(0, Math.min(100, p));
  const fill = Math.round((n / 100) * w);
  return `${pctColor(n, threshold)}${"\u2588".repeat(fill)}${DIM}${"\u2591".repeat(Math.max(0, w - fill))}${R}`;
}

function shortProvider(name: string): string {
  const trimmed = name
    .replace(/ Account Quota$/i, "")
    .replace(/ Coding Plan$/i, "")
    .replace(/ Token Plan$/i, "")
    .replace(/ Cloud$/i, "")
    .replace(/ Usage$/i, "")
    .replace(/ Quota$/i, "");
  const split = trimmed.split(" \u2014 ");
  if (split.length === 2 && split[0].toLowerCase().includes(split[1].toLowerCase())) return split[0];
  return trimmed;
}

/** `Google — a@gmail.com` → `Google — a`, kept only while it stays unambiguous. */
function compactNames(names: string[]): string[] {
  const shortened = names.map((n) => n.replace(/([\w.+-]+)@[\w.-]+/g, "$1"));
  const seen = new Map<string, number>();
  for (const n of shortened) seen.set(n, (seen.get(n) ?? 0) + 1);
  return names.map((n, i) => ((seen.get(shortened[i]) ?? 0) === 1 ? shortened[i] : n));
}

function dropEmailDomains(groups: Group[]): void {
  const names = compactNames(groups.map((g) => g.name));
  groups.forEach((g, i) => {
    g.name = names[i];
  });
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const v of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < v.length && prefix[i] === v[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix.replace(/[\s\u2014\u00b7,-]+$/, "");
}

/** Providers often wrap their own name around a nested error: `X: X failed`. */
function dedupePrefix(detail: string): string {
  return detail.replace(/^(.{3,40}?):\s*\1/i, "$1");
}

function wrapText(text: string, width: number, indent = ""): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && dw(next) > width) {
      lines.push(cur);
      cur = indent + word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function shortNote(note: string | undefined): string | undefined {
  const m = note ? /^cached \((\d+) min ago\)$/i.exec(note.trim()) : null;
  return m ? `cached ${fmtDur(Number(m[1]) * 60)} ago` : note;
}

/** Drop noise already carried by the provider name (emails) and filler words. */
function shortLabel(label: string, provider: string): string {
  let out = label;
  for (const email of provider.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
    const esc = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\s*[\u00b7\u2014-]?\\s*${esc}`, "gi"), "");
  }
  out = out
    .replace(/\s*\blimits?\b$/i, "")
    .replace(/\(([^)]*)\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[\u00b7\u2014-]\s*$/, "")
    .trim();
  return out || label;
}

function staleBadge(stale: { ageMs: number } | undefined): string | undefined {
  if (!stale) return undefined;
  return `${YEL}stale ${fmtDur(Math.floor(stale.ageMs / 1000))}${R}`;
}

function resetText(resetMs: number | undefined, ageMs: number): string {
  if (typeof resetMs !== "number" || !Number.isFinite(resetMs) || resetMs <= 0) return "";
  const left = resetMs - ageMs;
  if (left <= 0) return `${RESET_MARK} now`;
  return `${RESET_MARK} ${fmtDur(Math.floor(left / 1000))}`;
}

// ── window tiering ────────────────────────────────────────────

type Tier = "short" | "weekly" | "monthly";

function windowTier(label: string, resetMs?: number): Tier {
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
 * Current  = actionable quota now (short-term, or best available if that's all they have).
 * Weekly   = every 7-day/weekly window, including weekly-only providers.
 * Monthly  = billing-cycle windows only when the provider also has shorter tiers.
 */
function windowsForView(windows: MyStatusViewWindow[], view: Horizon): MyStatusViewWindow[] {
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

// ── body model ────────────────────────────────────────────────

function groupsForView(model: MyStatusViewModel, horizon: Horizon): Group[] {
  const groups: Group[] = [];
  for (const p of model.providers) {
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
      name: shortProvider(p.name),
      source: p.name,
      note: shortNote(p.note),
      stale: p.stale,
      windows: sorted,
      worst: Math.min(...sorted.map((w) => w.remaining)),
      soonest,
    });
  }
  dropEmailDomains(groups);
  return groups.sort((a, b) => {
    if (a.worst !== b.worst) return a.worst - b.worst;
    return (a.soonest ?? Infinity) - (b.soonest ?? Infinity);
  });
}

function buildBody(groups: Group[], mode: "detail" | "compact"): BodyLine[] {
  const out: BodyLine[] = [];
  for (const g of groups) {
    if (mode === "compact") {
      const worst = g.windows[0];
      out.push({
        kind: "row",
        label: g.name,
        remaining: g.worst,
        resetMs: worst?.resetMs,
        indent: 0,
        badge: staleBadge(g.stale),
        suffix: worst ? shortLabel(worst.label, g.source) : undefined,
        source: g.source,
      });
      continue;
    }
    out.push({ kind: "header", name: g.name, note: g.note, badge: staleBadge(g.stale), source: g.source });
    for (const w of g.windows) {
      out.push({
        kind: "row",
        label: shortLabel(w.label, g.source),
        remaining: w.remaining,
        resetMs: w.resetMs,
        indent: 2,
        source: g.source,
      });
    }
  }
  return out;
}

function layoutFor(body: BodyLine[], W: number): Layout {
  let maxLabel = 0;
  let indentW = 0;
  let maxProv = 0;
  let maxStatus = 0;
  for (const l of body) {
    if (l.kind === "issue") {
      maxProv = Math.max(maxProv, dw(l.provider));
      maxStatus = Math.max(maxStatus, dw(l.status));
      continue;
    }
    if (l.kind !== "row") continue;
    maxLabel = Math.max(maxLabel, dw(l.label));
    indentW = Math.max(indentW, l.indent);
  }
  // row = gutter(1) + indent + label + sp + bar + sp + pct(4) + sp + reset(9)
  const fixed = 17 + indentW;
  let labelW = Math.max(6, Math.min(maxLabel, 22));
  if (W - fixed - labelW < 8) labelW = Math.max(6, W - fixed - 8);
  const barW = Math.max(8, Math.min(26, W - fixed - labelW));
  return {
    W,
    labelW,
    barW,
    indentW,
    provW: Math.max(8, Math.min(maxProv, 28)),
    statusW: Math.max(6, Math.min(maxStatus, 16)),
  };
}

function rowWidth(layout: Layout, indent: number): number {
  return 17 + indent + layout.labelW + layout.barW;
}

function renderBody(line: BodyLine, layout: Layout, threshold: number, ageMs: number): string {
  switch (line.kind) {
    case "text":
      return ` ${DIM}${clip(line.text, layout.W - 1)}${R}`;
    case "header": {
      const name = `${BOLD}${clip(line.name, Math.max(8, layout.W - 26))}${R}`;
      const right = line.badge ?? (line.note ? `${DIM}${clip(line.note, 24)}${R}` : undefined);
      if (!right) return ` ${name}`;
      return joinLR(` ${name}`, `${right} `, layout.W);
    }
    case "row": {
      const label = padR(clip(line.label, layout.labelW), layout.labelW);
      const shown = line.indent > 0 ? `${DIM}${label}${R}` : label;
      const pct = `${pctColor(line.remaining, threshold)}${padL(`${line.remaining}%`, 4)}${R}`;
      const rst = `${DIM}${padL(resetText(line.resetMs, ageMs), 9)}${R}`;
      let out = `${" ".repeat(1 + line.indent)}${shown} ${bar(line.remaining, layout.barW, threshold)} ${pct} ${rst}`;
      let room = layout.W - rowWidth(layout, line.indent) - 3;
      if (line.badge && room >= 8) {
        out += `  ${line.badge}`;
        room -= dw(strip(line.badge)) + 2;
      }
      if (line.suffix && room >= 6) out += `${DIM}  ${clip(line.suffix, room)}${R}`;
      return clip(out, layout.W);
    }
    case "issue": {
      const prov = padR(clip(line.provider, layout.provW), layout.provW);
      const room = layout.W - (4 + layout.provW + layout.statusW) - 2;
      if (!line.detail || room < 6) {
        return clip(` ${line.color}${line.marker}${R} ${prov} ${line.color}${line.status}${R}`, layout.W);
      }
      const status = padR(clip(line.status, layout.statusW), layout.statusW);
      const head = ` ${line.color}${line.marker}${R} ${prov} ${line.color}${status}${R}`;
      return clip(`${head}  ${DIM}${clip(line.detail, room)}${R}`, layout.W);
    }
    case "hidden-row": {
      const name = padR(clip(line.name, Math.max(10, layout.W - 28)), Math.max(10, layout.W - 28));
      return ` ${DIM}${name}${R}  ${DIM}x to show${R}`;
    }
  }
}

/** Collapse sub-accounts that failed for the same reason into one row. */
function groupIssueRows(issues: StatusIssue[], names: string[]): BodyLine[] {
  const buckets = new Map<string, { issue: StatusIssue; names: string[] }>();
  issues.forEach((issue, i) => {
    const detail = dedupePrefix(issue.detail);
    const key = `${issue.kind}|${detail}|${Math.round((issue.ageMs ?? 0) / 60_000)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.names.push(names[i]);
    else buckets.set(key, { issue, names: [names[i]] });
  });

  const rows: BodyLine[] = [];
  for (const { issue, names: group } of buckets.values()) {
    const stale = issue.kind === "stale";
    rows.push({
      kind: "issue",
      marker: "!",
      color: stale ? YEL : RED,
      provider:
        group.length > 1 ? `${commonPrefix(group) || group[0]} (${group.length} accounts)` : group[0],
      status: stale ? `stale ${fmtDur(Math.floor((issue.ageMs ?? 0) / 1000))}` : "failed",
      detail: dedupePrefix(issue.detail),
    });
  }
  return rows;
}

function buildIssueBody(model: MyStatusViewModel, W: number): BodyLine[] {
  const h = model.health;
  const parts = [`${h.rendered} of ${h.queried} providers reporting`];
  if (h.failed) parts.push(`${h.failed} failed`);
  if (h.stale) parts.push(`${h.stale} stale`);
  if (h.unconfigured) parts.push(`${h.unconfigured} not configured`);
  const out: BodyLine[] = [{ kind: "text", text: parts.join(" \u00b7 ") }, { kind: "text", text: "" }];

  const attention = model.issues.filter((i) => i.kind !== "unconfigured");
  if (attention.length === 0) {
    out.push({ kind: "text", text: "Every configured provider answered live \u2014 nothing to fix." });
  } else {
    const names = compactNames(attention.map((i) => shortProvider(i.provider)));
    out.push(...groupIssueRows(attention, names));
  }

  const idle = model.issues.filter((i) => i.kind === "unconfigured");
  if (idle.length > 0) {
    out.push({ kind: "text", text: "" });
    const names = compactNames(idle.map((i) => shortProvider(i.provider))).join(", ");
    for (const line of wrapText(`Not configured: ${names}`, Math.max(20, W - 3), "  ")) {
      out.push({ kind: "text", text: line });
    }
  }
  return out;
}

// ── frame ─────────────────────────────────────────────────────

interface FrameInput {
  model: MyStatusViewModel | { error: string };
  fetchedAt: number;
  viewIdx: number;
  pane: Pane;
  scroll: number;
  density: Density;
  fetching: boolean;
  nextSec: number;
  cols: number;
  rows: number;
  hidden: Set<string>;
  hiddenCount: number;
}

/** Find the provider source name for the body line at a given scroll offset. */
function providerAt(body: BodyLine[], scroll: number): string | undefined {
  // Walk backwards from the scroll position to find the nearest header/row with a source.
  for (let i = Math.min(scroll, body.length - 1); i >= 0; i--) {
    const l = body[i];
    if (l.kind === "header" || l.kind === "row" || l.kind === "hidden-row") return l.source;
  }
  return undefined;
}

function buildHiddenBody(model: MyStatusViewModel, hidden: Set<string>): BodyLine[] {
  const out: BodyLine[] = [];
  if (hidden.size === 0) {
    out.push({ kind: "text", text: "No hidden providers. Press x on a provider to hide it." });
    return out;
  }
  out.push({ kind: "text", text: `${hidden.size} hidden \u2014 press x to show a provider again` });
  out.push({ kind: "text", text: "" });
  const matched = model.providers.filter((p) => hidden.has(p.name.toLowerCase()));
  const names = compactNames(matched.map((p) => shortProvider(p.name)));
  matched.forEach((p, i) => {
    out.push({ kind: "hidden-row", name: names[i], source: p.name });
  });
  return out;
}

function statusText(fetching: boolean, ageSec: number, nextSec: number): string {
  const left = fetching ? `${YEL}syncing${R}` : `${DIM}${fmtAge(ageSec)} ago${R}`;
  return `${left}${DIM}   sync ${nextSec}s ${R}`;
}

/** Attention flags, in decreasing verbosity; the widest one that fits is used. */
function attentionFlags(model: MyStatusViewModel, long: boolean): string {
  const h = model.health;
  const parts: string[] = [];
  if (model.alerts.length) {
    const n = model.alerts.length;
    parts.push(`${RED}${n} ${long ? (n > 1 ? "alerts" : "alert") : "low"}${R}`);
  }
  if (h.failed) parts.push(`${RED}${h.failed} failed${R}`);
  if (h.stale) parts.push(`${YEL}${h.stale} stale${R}`);
  if (h.unconfigured) parts.push(`${DIM}${h.unconfigured} ${long ? "not configured" : "idle"}${R}`);
  return parts.join(SEP);
}

function firstFitting(candidates: string[], left: string, W: number): string {
  for (const c of candidates) {
    if (!strip(c)) return c;
    if (dw(strip(left)) + dw(strip(c)) + 2 <= W) return c;
  }
  return "";
}

function buildFrame(input: FrameInput): { lines: string[]; scroll: number; body: BodyLine[] } {
  const W = Math.max(24, input.cols - 1);
  const bodyH = Math.max(3, input.rows - CHROME_H);
  const ageMs = Math.max(0, Date.now() - input.fetchedAt);
  const ageSec = Math.floor(ageMs / 1000);
  const rule = `${DIM}${RULE.repeat(W)}${R}`;
  const lines: string[] = [];

  if ("error" in input.model) {
    lines.push(joinLR(` ${BOLD}usage${R}`, statusText(input.fetching, ageSec, input.nextSec), W));
    lines.push(` ${DIM}waiting for provider data${R}`);
    lines.push(rule);
    const body = input.model.error.split("\n").slice(0, bodyH);
    for (const line of body) lines.push(` ${RED}${clip(line, W - 1)}${R}`);
    for (let i = body.length; i < bodyH; i++) lines.push("");
    lines.push(rule);
    lines.push(` ${DIM}r retry${R}${SEP}${DIM}q quit${R}`);
    return { lines, scroll: 0, body: [] };
  }

  const model = input.model;
  const view = VIEWS[input.viewIdx];
  const issuesPane = input.pane === "issues";
  const hiddenPane = input.pane === "hidden";
  const groups = groupsForView(model, view.id).filter((g) => !input.hidden.has(g.source.toLowerCase()));
  const detailH = groups.reduce((n, g) => n + 1 + g.windows.length, 0);
  const mode: "detail" | "compact" =
    input.density === "auto" ? (detailH <= bodyH ? "detail" : "compact") : input.density;

  const body: BodyLine[] = hiddenPane
    ? buildHiddenBody(model, input.hidden)
    : issuesPane
      ? buildIssueBody(model, W)
      : groups.length
        ? buildBody(groups, mode)
        : [{ kind: "text", text: `No ${view.title.toLowerCase()} quotas \u00b7 ${view.hint}` }];

  const layout = layoutFor(body, W);
  const maxScroll = Math.max(0, body.length - bodyH);
  const off = Math.min(Math.max(0, input.scroll), maxScroll);
  const visible = body.slice(off, off + bodyH);

  const s = model.summary;
  const counts = `${GRN}${s.green}${R}${DIM} ok${R}${SEP}${YEL}${s.yellow}${R}${DIM} watch${R}${SEP}${RED}${s.red}${R}${DIM} low${R}`;
  lines.push(
    joinLR(
      ` ${BOLD}usage${R}  ${DIM}${s.accounts} accounts${R}${SEP}${counts}`,
      statusText(input.fetching, ageSec, input.nextSec),
      W,
    ),
  );

  const tab = (key: string, title: string, active: boolean): string =>
    active ? `${BOLD}${key} ${title}${R}` : `${DIM}${key} ${title}${R}`;
  const attention = model.health.failed + model.health.stale;
  const quotaActive = !issuesPane && !hiddenPane;
  const tabs = [
    ...VIEWS.map((v, i) => tab(v.key, v.title, quotaActive && i === input.viewIdx)),
    tab("e", attention ? `Issues ${attention}` : "Issues", issuesPane),
    ...(input.hiddenCount > 0
      ? [tab("x", `Hidden ${input.hiddenCount}`, hiddenPane)]
      : []),
  ].join(SEP);
  const flags = firstFitting(
    [attentionFlags(model, true), attentionFlags(model, false), ""],
    ` ${tabs}`,
    W - 1,
  );
  lines.push(joinLR(` ${tabs}`, flags ? `${flags} ` : "", W));
  lines.push(rule);

  for (const line of visible) lines.push(renderBody(line, layout, model.threshold, ageMs));
  for (let i = visible.length; i < bodyH; i++) lines.push("");

  lines.push(rule);
  const pos = maxScroll > 0 ? `${DIM}${off + 1}\u2013${off + visible.length} of ${body.length}${R}${SEP}` : "";
  const state = hiddenPane
    ? `${pos}${DIM}hidden${R}`
    : issuesPane
      ? `${pos}${DIM}issues${R}`
      : `${pos}${DIM}${input.density === "auto" ? `${mode} (auto)` : mode}${R}`;
  const keys = firstFitting(
    [
      ` ${DIM}1/2/3 view${R}${SEP}${DIM}e issues${R}${SEP}${DIM}x hide${R}${SEP}${DIM}d density${R}${SEP}${DIM}j/k scroll${R}${SEP}${DIM}r sync${R}${SEP}${DIM}q quit${R}`,
      ` ${DIM}1/2/3${R}${SEP}${DIM}e issues${R}${SEP}${DIM}x hide${R}${SEP}${DIM}d density${R}${SEP}${DIM}r sync${R}${SEP}${DIM}q quit${R}`,
      ` ${DIM}1/2/3${R}${SEP}${DIM}e${R}${SEP}${DIM}x${R}${SEP}${DIM}d${R}${SEP}${DIM}r${R}${SEP}${DIM}q${R}`,
    ],
    `${state} `,
    W,
  );
  lines.push(joinLR(keys, `${state} `, W));

  return { lines, scroll: off, body };
}

// ── differential painter ──────────────────────────────────────

function createScreen(): { paint(lines: string[], cols: number, rows: number): void; invalidate(): void } {
  let prev: string[] = [];
  let size = "";
  return {
    paint(lines, cols, rows) {
      let out = "";
      const key = `${cols}x${rows}`;
      if (key !== size) {
        out += CLEAR;
        prev = [];
        size = key;
      }
      const n = Math.min(lines.length, rows);
      for (let i = 0; i < n; i++) {
        if (prev[i] === lines[i]) continue;
        out += `\x1b[${i + 1};1H${lines[i]}${EL}`;
      }
      if (prev.length > n) out += `\x1b[${n + 1};1H${ED}`;
      if (out) process.stdout.write(out);
      prev = lines.slice(0, n);
    },
    invalidate() {
      prev = [];
      size = "";
    },
  };
}

// ── loop ──────────────────────────────────────────────────────

export async function runMyStatusTui(options: MyStatusTuiOptions): Promise<void> {
  const cfg = loadConfig();
  const intervalSec = Math.max(5, options.intervalSec ?? cfg.watchIntervalSec ?? 60);
  const uiMs = Math.max(250, (cfg.uiRefreshSec ?? 1) * 1000);
  const baseArgs = { ...options.args, format: "ansi" as const };

  const screen = createScreen();
  let snapshot: MyStatusSnapshot = { ran: [], fetchedAt: Date.now() };
  let model: MyStatusViewModel | { error: string } = { error: "Loading\u2026" };
  let viewIdx = 0;
  let scroll = 0;
  let density: Density = "auto";
  let pane: Pane = "quota";
  let fetching = false;
  let nextFetchAt = 0;
  let forceFetch = false;
  let quit = false;

  // Persisted hidden providers (still queried, filtered from display).
  const hidden = new Set<string>((cfg.providers?.hidden ?? []).map((s) => s.toLowerCase()));
  let currentBody: BodyLine[] = [];

  const persistHidden = (): void => {
    const existing = loadConfig();
    const arr = [...hidden];
    saveConfig({ providers: { ...existing.providers, hidden: arr } });
  };

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  const wasPaused = stdin.isPaused();

  const enter = (): void => {
    process.stdout.write(ALT_ON + HIDE + CLEAR);
    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.resume();
    }
  };
  const leave = (): void => {
    process.stdout.write(SHOW + ALT_OFF);
    if (stdin.isTTY) {
      stdin.setRawMode(wasRaw ?? false);
      if (wasPaused) stdin.pause();
    }
  };

  const paint = (): void => {
    const { cols, rows } = term();
    const nextSec = fetching ? intervalSec : Math.max(0, Math.ceil((nextFetchAt - Date.now()) / 1000));
    const frame = buildFrame({
      model,
      fetchedAt: snapshot.fetchedAt,
      viewIdx,
      pane,
      scroll,
      density,
      fetching,
      nextSec,
      cols,
      rows,
      hidden,
      hiddenCount: hidden.size,
    });
    scroll = frame.scroll;
    currentBody = frame.body;
    screen.paint(frame.lines, cols, rows);
  };

  const bodyHeight = (): number => Math.max(3, term().rows - CHROME_H);

  const doFetch = async (fresh: boolean): Promise<void> => {
    fetching = true;
    paint();
    try {
      snapshot = await queryMyStatus({ ...baseArgs, fresh });
      model = buildMyStatusViewModel(snapshot, baseArgs, { recordHistory: true });
      nextFetchAt = Date.now() + intervalSec * 1000;
    } finally {
      fetching = false;
      paint();
    }
  };

  const applyKey = (k: string): "quit" | "sync" | "paint" | "none" => {
    if (k === "q" || k === "\u0003") return "quit";
    if (k === "r" || k === "R") return "sync";
    if (k === "1" || k === "2" || k === "3") {
      viewIdx = Number(k) - 1;
      pane = "quota";
      scroll = 0;
    } else if (k === "\t") {
      viewIdx = (viewIdx + 1) % VIEWS.length;
      pane = "quota";
      scroll = 0;
    } else if (k === "e" || k === "E") {
      pane = pane === "issues" ? "quota" : "issues";
      scroll = 0;
    } else if (k === "x") {
      if (currentBody.length === 0) return "none";
      const src = providerAt(currentBody, scroll);
      if (!src) return "none";
      const key = src.toLowerCase();
      if (pane === "hidden") {
        hidden.delete(key);
        persistHidden();
      } else if (pane === "quota") {
        hidden.add(key);
        persistHidden();
      } else {
        return "none";
      }
      scroll = 0;
    } else if (k === "\u001b") {
      if (pane === "quota") return "none";
      pane = "quota";
      scroll = 0;
    } else if (k === "d" || k === "D") {
      density = DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length];
      scroll = 0;
    } else if (k === "g") {
      scroll = 0;
    } else if (k === "G") {
      scroll = Number.MAX_SAFE_INTEGER;
    } else if (k === "j" || k === "\u001b[B" || k === "\u001bOB") {
      scroll++;
    } else if (k === "k" || k === "\u001b[A" || k === "\u001bOA") {
      scroll = Math.max(0, scroll - 1);
    } else if (k === " " || k === "\u001b[6~") {
      scroll += bodyHeight();
    } else if (k === "b" || k === "\u001b[5~") {
      scroll = Math.max(0, scroll - bodyHeight());
    } else {
      return "none";
    }
    return "paint";
  };

  const onKey = (buf: Buffer): void => {
    let dirty = false;
    for (const k of keyTokens(buf.toString())) {
      const action = applyKey(k);
      if (action === "quit") {
        quit = true;
        return;
      }
      if (action === "sync") forceFetch = true;
      if (action !== "none") dirty = true;
    }
    if (dirty) paint();
  };

  enter();
  const onSig = (): void => {
    quit = true;
  };
  const onResize = (): void => {
    screen.invalidate();
    paint();
  };
  process.on("SIGINT", onSig);
  process.stdout.on("resize", onResize);
  stdin.on("data", onKey);

  try {
    await doFetch(false);
    while (!quit) {
      if (forceFetch) {
        forceFetch = false;
        await doFetch(true);
      } else if (Date.now() >= nextFetchAt) {
        await doFetch(false);
      } else {
        paint();
      }
      await new Promise((r) => setTimeout(r, uiMs));
    }
  } finally {
    process.off("SIGINT", onSig);
    process.stdout.off("resize", onResize);
    stdin.off("data", onKey);
    leave();
  }
}
