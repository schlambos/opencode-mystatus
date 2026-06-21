/**
 * Live TUI — single-pane usage board with Current / Weekly / Monthly views.
 * One-shot CLI / OpenCode tool unchanged.
 */

import {
  buildMyStatusViewModel,
  loadConfig,
  queryMyStatus,
  type MyStatusArgs,
  type MyStatusSnapshot,
  type MyStatusViewModel,
  type MyStatusViewWindow,
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
const HOME = "\x1b[H";
const CLR = "\x1b[2J";

const BOX = { tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518", h: "\u2500", v: "\u2502", t: "\u252c", b: "\u2534" };

const INDENT = "    ";

type Horizon = "current" | "weekly" | "monthly";

const VIEWS: { id: Horizon; key: string; title: string; hint: string }[] = [
  { id: "current", key: "1", title: "Current", hint: "what you have left now" },
  { id: "weekly", key: "2", title: "Weekly", hint: "7-day / weekly (multi-tier only)" },
  { id: "monthly", key: "3", title: "Monthly", hint: "monthly / credits (multi-tier only)" },
];

export interface MyStatusTuiOptions {
  args: MyStatusArgs;
  intervalSec?: number;
}

type DisplayLine =
  | { kind: "blank" }
  | { kind: "empty"; text: string }
  | { kind: "provider"; name: string; worst: number }
  | { kind: "label"; text: string }
  | { kind: "meter"; remaining: number; resetMs?: number };

// ── helpers ───────────────────────────────────────────────────

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

function trunc(s: string, w: number): string {
  if (dw(s) <= w) return s;
  let acc = 0;
  let out = "";
  for (const cp of s) {
    const cw = dw(cp);
    if (acc + cw > w - 1) break;
    out += cp;
    acc += cw;
  }
  return out + "\u2026";
}

function padR(s: string, w: number): string {
  const v = strip(s);
  return dw(v) > w ? trunc(s, w) : s + " ".repeat(w - dw(v));
}

function term(): { cols: number; rows: number } {
  return { cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
}

function fmtDur(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const p: string[] = [];
  if (d) p.push(`${d}d`);
  if (h) p.push(`${h}h`);
  if (m || !p.length) p.push(`${m}m`);
  return p.join(" ");
}

function fmtAge(sec: number): string {
  return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;
}

function pctColor(p: number): string {
  if (p < 25) return RED;
  if (p < 50) return YEL;
  return GRN;
}

function bar(p: number, w: number): string {
  const n = Math.max(0, Math.min(100, p));
  const fill = Math.round((n / 100) * w);
  const c = pctColor(n);
  return `${c}${"\u2588".repeat(fill)}${DIM}${"\u2591".repeat(Math.max(0, w - fill))}${R}`;
}

function shortProvider(name: string): string {
  return name
    .replace(/ Account Quota$/i, "")
    .replace(/ Coding Plan$/i, "")
    .replace(/ Token Plan$/i, "")
    .replace(/ Cloud$/i, "");
}

function resetStr(ms: number | undefined): string {
  if (ms === undefined) return "\u2014";
  if (ms <= 0) return "now";
  return fmtDur(Math.floor(ms / 1000));
}

/** Raw time bucket for a single quota window. */
type Tier = "short" | "weekly" | "monthly";

function windowTier(label: string, resetMs?: number): Tier {
  const l = label.toLowerCase();

  if (/\bmonthly\b/.test(l) || /\b30[\s-]?day\b/.test(l)) return "monthly";
  if (/\bcredits?\b/.test(l) || /\bbalance\b/.test(l) || /\bpoints\b/.test(l) || /\btotal\b/.test(l)) {
    return "monthly";
  }
  if (/\bweekly\b/.test(l) || /\b7[\s-]?day\b/.test(l) || /\bweek\b/.test(l)) return "weekly";
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
 * Weekly   = longer windows only when the provider also has short-term tiers.
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
      return short.length > 0 ? weekly : [];
    case "monthly":
      return short.length > 0 || weekly.length > 0 ? monthly : [];
  }
}

function buildDisplayLines(model: MyStatusViewModel, viewIdx: number): DisplayLine[] {
  const horizon = VIEWS[viewIdx]?.id ?? "current";

  const providers = model.providers
    .map((p) => {
      const windows = windowsForView(p.windows, horizon);
      if (windows.length === 0) return null;
      const worst = Math.min(...windows.map((w) => w.remaining));
      const soonest = windows.reduce<number | undefined>((s, w) => {
        if (typeof w.resetMs !== "number") return s;
        return s === undefined || w.resetMs < s ? w.resetMs : s;
      }, undefined);
      return { ...p, windows, worst, soonest };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => {
      if (a.worst !== b.worst) return a.worst - b.worst;
      return (a.soonest ?? Infinity) - (b.soonest ?? Infinity);
    });

  if (providers.length === 0) {
    const view = VIEWS[viewIdx];
    return [{ kind: "empty", text: `No ${view.title.toLowerCase()} quotas (${view.hint})` }];
  }

  const lines: DisplayLine[] = [];
  for (let pi = 0; pi < providers.length; pi++) {
    const p = providers[pi];
    if (pi > 0) lines.push({ kind: "blank" });
    lines.push({ kind: "provider", name: shortProvider(p.name), worst: p.worst });

    const windows = [...p.windows].sort((a, b) => {
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return (a.resetMs ?? Infinity) - (b.resetMs ?? Infinity);
    });

    for (const w of windows) {
      lines.push({ kind: "label", text: w.label });
      lines.push({ kind: "meter", remaining: w.remaining, resetMs: w.resetMs });
    }
  }
  return lines;
}

function renderTabBar(viewIdx: number, W: number): string {
  const parts = VIEWS.map((v, i) => {
    const active = i === viewIdx;
    const label = `${v.key} ${v.title}`;
    return active ? `${BOLD}[${label}]${R}` : `${DIM} ${v.key} ${v.title} ${R}`;
  });
  const hint = `${DIM}${VIEWS[viewIdx].hint}${R}`;
  const tabs = parts.join("   ");
  const gap = Math.max(2, W - dw(strip(tabs)) - dw(strip(hint)));
  return `${tabs}${" ".repeat(gap)}${hint}`;
}

// ── render ────────────────────────────────────────────────────

function hbar(w: number): string {
  return BOX.tl + BOX.h.repeat(w) + BOX.tr;
}

function mbar(w: number): string {
  return BOX.t + BOX.h.repeat(w) + BOX.t;
}

function fbar(w: number): string {
  return BOX.b + BOX.h.repeat(w) + BOX.b;
}

function ebar(w: number): string {
  return BOX.bl + BOX.h.repeat(w) + BOX.br;
}

function vline(inner: string, w: number): string {
  return BOX.v + padR(` ${inner}`, w) + BOX.v;
}

function renderLine(line: DisplayLine, W: number, barW: number): string {
  switch (line.kind) {
    case "blank":
      return "";
    case "empty":
      return `${DIM}${INDENT}${line.text}${R}`;
    case "provider": {
      const name = `${BOLD}${line.name}${R}`;
      const worst = `${DIM}lowest ${pctColor(line.worst)}${line.worst}%${R}`;
      const gap = Math.max(2, W - dw(strip(name)) - dw(strip(worst)) - 2);
      return `${name}${" ".repeat(gap)}${worst}`;
    }
    case "label":
      return `${INDENT}${line.text}`;
    case "meter": {
      const b = bar(line.remaining, barW);
      const pct = `${pctColor(line.remaining)}${line.remaining}%${R} ${DIM}left${R}`;
      const rst = `${DIM}resets ${resetStr(line.resetMs)}${R}`;
      return `${INDENT}${b}   ${pct}   ${rst}`;
    }
  }
}

function render(
  model: MyStatusViewModel | { error: string },
  snapshot: MyStatusSnapshot,
  viewIdx: number,
  scroll: number,
  fetching: boolean,
  nextSec: number,
): number {
  const { cols, rows } = term();
  const W = cols - 2;
  const bodyH = Math.max(4, rows - 7);
  const barW = Math.max(14, Math.min(40, W - dw(INDENT) - 34));

  if ("error" in model) {
    let out = CLR + HOME + hbar(W) + "\n";
    for (const line of model.error.split("\n").slice(0, bodyH + 2)) {
      out += vline(`${RED}${line}${R}`, W) + "\n";
    }
    out += fbar(W) + "\n" + vline(`${DIM}q quit${R}`, W) + "\n" + ebar(W);
    process.stdout.write(out);
    return 0;
  }

  const age = Math.floor((Date.now() - snapshot.fetchedAt) / 1000);
  const status = fetching ? `${YEL}syncing${R}` : `${DIM}${fmtAge(age)} ago${R}`;
  const s = model.summary;

  const titleL = `${BOLD}usage${R} ${DIM}remaining quota${R}`;
  const titleR = `${status}   ${DIM}refresh ${nextSec}s${R}`;
  const titleGap = Math.max(2, W - dw(strip(titleL)) - dw(strip(titleR)) - 1);

  const sumParts = [
    `${s.accounts} accounts`,
    `${GRN}${s.green}${R} ok`,
    `${YEL}${s.yellow}${R} watch`,
    `${RED}${s.red}${R} low`,
  ];
  const sumLine = sumParts.join(`  ${DIM}\u00b7${R}  `);

  const allLines = buildDisplayLines(model, viewIdx);
  const maxScroll = Math.max(0, allLines.length - bodyH);
  const off = Math.min(Math.max(0, scroll), maxScroll);
  const visible = allLines.slice(off, off + bodyH);

  let out = CLR + HOME;
  out += hbar(W) + "\n";
  out += vline(`${titleL}${" ".repeat(titleGap)}${titleR}`, W) + "\n";
  out += vline(sumLine, W) + "\n";
  out += vline(renderTabBar(viewIdx, W), W) + "\n";
  out += mbar(W) + "\n";

  for (const line of visible) {
    out += vline(renderLine(line, W, barW), W) + "\n";
  }
  for (let i = visible.length; i < bodyH; i++) {
    out += vline("", W) + "\n";
  }

  out += fbar(W) + "\n";
  const alert = model.alerts.length ? `  ${RED}${model.alerts.length} alert${model.alerts.length > 1 ? "s" : ""}${R}` : "";
  const scrollHint =
    maxScroll > 0 ? `${DIM}lines ${off + 1}\u2013${off + visible.length} of ${allLines.length}${R}` : "";
  const keys = `${DIM}1/2/3 views   j/k scroll   r sync   q quit${R}`;
  const footGap = Math.max(2, W - dw(strip(keys)) - dw(strip(scrollHint)) - dw(strip(alert)));
  out += vline(`${keys}${" ".repeat(footGap)}${scrollHint}${alert}`, W) + "\n";
  out += ebar(W);

  process.stdout.write(out);
  return off;
}

// ── loop ──────────────────────────────────────────────────────

export async function runMyStatusTui(options: MyStatusTuiOptions): Promise<void> {
  const cfg = loadConfig();
  const intervalSec = Math.max(5, options.intervalSec ?? cfg.watchIntervalSec ?? 60);
  const uiMs = Math.max(250, (cfg.uiRefreshSec ?? 1) * 1000);
  const baseArgs = { ...options.args, format: "ansi" as const };

  let snapshot: MyStatusSnapshot = { ran: [], fetchedAt: Date.now() };
  let model: MyStatusViewModel | { error: string } = { error: "Loading\u2026" };
  let viewIdx = 0;
  let scroll = 0;
  let fetching = false;
  let nextFetchAt = 0;
  let forceFetch = false;
  let quit = false;

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  const wasPaused = stdin.isPaused();

  const enter = (): void => {
    process.stdout.write(ALT_ON + HIDE + CLR);
    if (stdin.isTTY) { stdin.setRawMode(true); stdin.resume(); }
  };
  const leave = (): void => {
    process.stdout.write(SHOW + ALT_OFF);
    if (stdin.isTTY) { stdin.setRawMode(wasRaw ?? false); if (wasPaused) stdin.pause(); }
  };

  const rebuild = (record: boolean): void => {
    model = buildMyStatusViewModel(snapshot, baseArgs, { recordHistory: record });
  };

  const lineCount = (): number => {
    if ("error" in model) return 0;
    return buildDisplayLines(model, viewIdx).length;
  };

  const setView = (idx: number): void => {
    viewIdx = Math.max(0, Math.min(VIEWS.length - 1, idx));
    scroll = 0;
    paint(false);
  };

  const paint = (record = false): void => {
    rebuild(record);
    const next = fetching ? intervalSec : Math.max(0, Math.ceil((nextFetchAt - Date.now()) / 1000));
    scroll = render(model, snapshot, viewIdx, scroll, fetching, next);
  };

  const doFetch = async (fresh: boolean): Promise<void> => {
    fetching = true;
    paint(false);
    try {
      snapshot = await queryMyStatus({ ...baseArgs, fresh });
      rebuild(true);
      nextFetchAt = Date.now() + intervalSec * 1000;
    } finally {
      fetching = false;
      paint(false);
    }
  };

  const onKey = (buf: Buffer): void => {
    const k = buf.toString();
    if (k === "q" || k === "\u0003") { quit = true; return; }
    if (k === "r" || k === "R") { forceFetch = true; return; }
    if (k === "1") { setView(0); return; }
    if (k === "2") { setView(1); return; }
    if (k === "3") { setView(2); return; }
    if (k === "\t") { setView((viewIdx + 1) % VIEWS.length); return; }
    if (k === "g") { scroll = 0; paint(false); return; }
    if (k === "G") { scroll = Math.max(0, lineCount() - 1); paint(false); return; }
    if (k === "j" || k === "\u001b[B" || k === "\u001bOB") { scroll++; paint(false); return; }
    if (k === "k" || k === "\u001b[A" || k === "\u001bOA") { scroll = Math.max(0, scroll - 1); paint(false); }
  };

  enter();
  const onSig = (): void => { quit = true; };
  const onResize = (): void => paint(false);
  process.on("SIGINT", onSig);
  process.stdout.on("resize", onResize);
  stdin.on("data", onKey);

  try {
    await doFetch(false);
    while (!quit) {
      if (forceFetch) { forceFetch = false; await doFetch(true); }
      else if (Date.now() >= nextFetchAt) await doFetch(false);
      else paint(false);
      await new Promise((r) => setTimeout(r, uiMs));
    }
  } finally {
    process.off("SIGINT", onSig);
    process.stdout.off("resize", onResize);
    stdin.off("data", onKey);
    leave();
  }
}
