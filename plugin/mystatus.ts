/**
 * allstatus.ts — All-in-one AI quota status plugin for OpenCode
 *
 * Platforms:
 *   - OpenAI      (ChatGPT Plus/Team/Pro)    auth.json → openai
 *   - Anthropic   (Claude.ai)               auth.json → anthropic
 *   - Google      (Antigravity free quota)   antigravity-accounts.json
 *   - GitHub Copilot                        auth.json → github-copilot (+ optional PAT)
 *   - OpenCode Go+Zen (merged cell)         shared dashboard config (workspaceId + authCookie)
 *   - Poe         (points balance)          auth.json, env var, or poe-api-key.json
 *   - Z.AI        (GLM Coding Plan)         auth.json → zai-coding-plan
 *   - xAI/Grok    (auth check only)         auth.json → xai-oauth (no usage API)
 *   - MiniMax     (Token Plan)              auth.json → minimax-coding-plan (Anthropic-compatible)
 *
 * Features:
 *   - ANSI color-coded progress bars (red/yellow/green)
 *   - Zen per-model cost breakdown from usage page SSR
 *   - Threshold alerts for low-remaining platforms
 *   - JSON output mode for programmatic consumption
 *   - Go + Zen merged into single cell per account
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ============================================================
// ANSI color helpers
// ============================================================

const ANSI_RESET = "\x1b[0m";
const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";

function colorForPercent(pct: number): string {
  if (pct <= 0) return ANSI_RED;
  if (pct < 25) return ANSI_RED;
  if (pct < 50) return ANSI_YELLOW;
  return ANSI_GREEN;
}

function emojiForPercent(pct: number): string {
  if (pct <= 0) return "\ud83d\udfe5"; // red square
  if (pct < 25) return "\ud83d\udfe7";  // orange square
  if (pct < 50) return "\ud83d\udfe8"; // yellow square
  return "\ud83d\udfe9"; // green square
}

// ============================================================
// Shared types
// ============================================================

interface QueryResult {
  success: boolean;
  output?: string;
  error?: string;
}

interface OpenAIAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

interface AnthropicAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

interface CopilotAuthData {
  type: string;
  refresh?: string;
  access?: string;
  expires?: number;
}

interface OpenCodeGoAuthData {
  type: string;
  key?: string;
}

interface PoeAuthData {
  type: string;
  refresh?: string;
  access?: string;
  expires?: number;
}

interface ZaiAuthData {
  type: string;
  key?: string;
}

interface XaiAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

interface MiniMaxAuthData {
  type: string;
  key?: string;
}

interface AuthData {
  openai?: OpenAIAuthData;
  anthropic?: AnthropicAuthData;
  "github-copilot"?: CopilotAuthData;
  "opencode-go"?: OpenCodeGoAuthData;
  poe?: PoeAuthData;
  "zai-coding-plan"?: ZaiAuthData;
  "xai-oauth"?: XaiAuthData;
  "minimax-coding-plan"?: MiniMaxAuthData;
}

interface AntigravityAccount {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  enabled?: boolean;
  cachedQuota?: Record<
    string,
    { remainingFraction: number; resetTime: string; modelCount?: number }
  >;
  cachedQuotaUpdatedAt?: number;
  fingerprint?: { userAgent?: string };
}

interface JsonCell {
  title: string;
  lines: string[];
}

// ============================================================
// Shared utilities
// ============================================================

function createProgressBar(remainPercent: number, width = 26, useAnsi = false): string {
  const p = Math.max(0, Math.min(100, remainPercent));
  const filled = Math.round((p / 100) * width);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  const emoji = emojiForPercent(p);
  if (!useAnsi) return `${emoji} ${bar}`;
  return `${emoji} ${colorForPercent(p)}${bar}${ANSI_RESET}`;
}

function formatDuration(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

function formatResetAt(isoTime: string): string {
  if (!isoTime) return "-";
  try {
    const diffMs = new Date(isoTime).getTime() - Date.now();
    if (diffMs <= 0) return "resetting";
    return formatDuration(Math.floor(diffMs / 1000));
  } catch {
    return "-";
  }
}

async function fetchTimeout(
  url: string,
  options: RequestInit,
  ms = 10_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError")
      throw new Error(`Request timed out after ${ms / 1000}s`);
    throw err;
  } finally {
    clearTimeout(id);
  }
}

// ============================================================
// Paths
// ============================================================

function authJsonPath(): string {
  return join(homedir(), ".local", "share", "opencode", "auth.json");
}

function opencodeConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

// ============================================================
// OpenAI
// ============================================================

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

interface OpenAIWindowData {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
}

interface OpenAIUsage {
  email?: string;
  plan_type: string;
  rate_limit: {
    allowed?: boolean;
    limit_reached: boolean;
    primary_window: OpenAIWindowData;
    secondary_window: OpenAIWindowData | null;
  } | null;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    overage_limit_reached?: boolean;
    balance?: string;
  } | null;
  rate_limit_reached_type?: { type?: string; details?: string } | null;
  rate_limit_reset_credits?: { available_count?: number } | null;
}

function formatOpenAIWindow(w: OpenAIWindowData, ansi = false): string[] {
  const remain = Math.round(100 - w.used_percent);
  const sec = w.limit_window_seconds;
  const name =
    sec >= 86400
      ? `${Math.round(sec / 86400)}-day limit`
      : `${Math.round(sec / 3600)}-hour limit`;
  return [
    name,
    `${createProgressBar(remain, 26, ansi)} ${remain}% remaining`,
    `Resets in: ${formatDuration(w.reset_after_seconds)}`,
  ];
}

async function queryOpenAI(auth: OpenAIAuthData | undefined, ansi = false): Promise<QueryResult | null> {
  if (!auth || auth.type !== "oauth" || !auth.access) return null;
  if (auth.expires && auth.expires < Date.now())
    return { success: false, error: "\u26a0\ufe0f OpenAI token expired. Use an OpenAI model in OpenCode to refresh." };

  try {
    const payload = parseJwtPayload(auth.access);
    const email =
      (payload?.["https://api.openai.com/profile"] as { email?: string } | undefined)?.email ?? null;
    const accountId =
      (payload?.["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined)
        ?.chatgpt_account_id ?? null;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.access}`,
      "User-Agent": "OpenCode-AllStatus/1.0",
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;

    const res = await fetchTimeout("https://chatgpt.com/backend-api/wham/usage", { headers });
    if (!res.ok) throw new Error(`OpenAI API error (${res.status})`);

    const data = (await res.json()) as OpenAIUsage;
    const lines: string[] = [
      `Account:        ${data.email ?? email ?? "unknown"}`,
      `Plan:           ChatGPT ${data.plan_type}`,
    ];

    const credits = data.credits;
    if (credits) {
      if (credits.unlimited) {
        lines.push("Credits:        unlimited");
      } else if (credits.has_credits || (credits.balance && credits.balance !== "0")) {
        lines.push(`Credits:        ${credits.balance ?? "?"}`);
      }
      if (credits.overage_limit_reached) lines.push("Overage:        \u26a0\ufe0f limit reached");
    }

    lines.push("");

    if (data.rate_limit?.primary_window)
      lines.push(...formatOpenAIWindow(data.rate_limit.primary_window, ansi));
    if (data.rate_limit?.secondary_window)
      lines.push("", ...formatOpenAIWindow(data.rate_limit.secondary_window, ansi));

    if (data.rate_limit?.limit_reached) {
      const reason = data.rate_limit_reached_type?.type
        ? ` (${data.rate_limit_reached_type.type})`
        : "";
      lines.push("", `\u26a0\ufe0f Rate limit reached!${reason}`);
      const resetCredits = data.rate_limit_reset_credits?.available_count ?? 0;
      if (resetCredits > 0)
        lines.push(`Reset credits available: ${resetCredits}`);
    }

    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Anthropic  (api.anthropic.com/api/oauth/usage — Claude Code internal endpoint)
// ============================================================

const ANTHROPIC_CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20";
const ANTHROPIC_USER_AGENT = "claude-code/1.0.17";

interface AnthropicWindow {
  utilization: number;
  resets_at: string;
}

interface AnthropicUsageResponse {
  five_hour?: AnthropicWindow;
  seven_day?: AnthropicWindow;
  seven_day_opus?: AnthropicWindow | null;
  seven_day_sonnet?: AnthropicWindow | null;
  seven_day_cowork?: AnthropicWindow | null;
  extra_usage?: {
    is_enabled?: boolean;
    monthly_limit?: number | null;
    used_credits?: number | null;
    utilization?: number | null;
    currency?: string | null;
    disabled_reason?: string | null;
  } | null;
}

const ANTHROPIC_MODEL_WINDOWS: Array<{ key: keyof AnthropicUsageResponse; label: string }> = [
  { key: "seven_day_opus", label: "7-day (Opus)" },
  { key: "seven_day_sonnet", label: "7-day (Sonnet)" },
  { key: "seven_day_cowork", label: "7-day (Cowork)" },
];

function formatAnthropicWindow(label: string, w: AnthropicWindow, ansi = false): string[] {
  const remain = Math.round(100 - w.utilization);
  return [
    label,
    `${createProgressBar(remain, 26, ansi)} ${remain}% remaining`,
    `Resets in: ${formatResetAt(w.resets_at)}`,
  ];
}

async function refreshAnthropicToken(refreshToken: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTHROPIC_CLAUDE_CODE_CLIENT_ID,
    });
    const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function queryAnthropic(auth: AnthropicAuthData | undefined, ansi = false): Promise<QueryResult | null> {
  if (!auth || auth.type !== "oauth") return null;

  let accessToken = auth.access;

  if (!accessToken || (auth.expires && auth.expires < Date.now())) {
    if (!auth.refresh) {
      return { success: false, error: "\u26a0\ufe0f Anthropic token expired and no refresh token available." };
    }
    const refreshed = await refreshAnthropicToken(auth.refresh);
    if (!refreshed) {
      return {
        success: false,
        error: "\u26a0\ufe0f Anthropic token expired \u2014 refresh failed.\nRe-authenticate with Anthropic in OpenCode to get a fresh token.",
      };
    }
    accessToken = refreshed;
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": ANTHROPIC_BETA_HEADER,
      "User-Agent": ANTHROPIC_USER_AGENT,
      "Content-Type": "application/json",
    };

    const res = await fetchTimeout(
      "https://api.anthropic.com/api/oauth/usage",
      { method: "GET", headers },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as AnthropicUsageResponse;

    const lines: string[] = ["Account:        Claude Pro/Max", ""];

    if (data.five_hour) {
      lines.push(...formatAnthropicWindow("5-hour limit", data.five_hour, ansi));
    }

    if (data.seven_day) {
      if (lines.length > 2) lines.push("");
      lines.push(...formatAnthropicWindow("7-day limit", data.seven_day, ansi));
    }

    for (const { key, label } of ANTHROPIC_MODEL_WINDOWS) {
      const w = data[key] as AnthropicWindow | null | undefined;
      if (w && typeof w.utilization === "number") {
        lines.push("", ...formatAnthropicWindow(label, w, ansi));
      }
    }

    const extra = data.extra_usage;
    if (extra?.is_enabled) {
      const cur = extra.currency ?? "USD";
      const used = extra.used_credits ?? 0;
      const limit = extra.monthly_limit;
      lines.push("", "Extra usage (overage)");
      if (typeof limit === "number" && limit > 0) {
        const util = Math.round(extra.utilization ?? (used / limit) * 100);
        const remain = Math.max(0, 100 - util);
        lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
        lines.push(`Used: ${used}/${limit} ${cur}`);
      } else {
        lines.push(`Used: ${used} ${cur}`);
      }
    }

    if (!data.five_hour && !data.seven_day) {
      lines.push("(No rolling-window limits found \u2014 may be API-key plan or unlimited)");
    }

    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Google Antigravity (cached-quota + live API fallback)
// ============================================================

const GOOGLE_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";

const GOOGLE_LIVE_MODELS: Array<{ key: string; altKey?: string; display: string }> = [
  { key: "gemini-3.1-pro-high", altKey: "gemini-3.1-pro-low", display: "G3 Pro" },
  { key: "gemini-3-pro-image", display: "G3 Image" },
  { key: "gemini-3-flash", display: "G3 Flash" },
  {
    key: "claude-opus-4-6-thinking",
    altKey: "claude-sonnet-4-6",
    display: "Claude",
  },
];

const GOOGLE_CACHED_GROUPS: Array<{ key: string; display: string }> = [
  { key: "gemini-pro", display: "Gemini Pro" },
  { key: "gemini-flash", display: "Gemini Flash" },
  { key: "claude", display: "Claude" },
];

async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

interface GoogleQuotaResponse {
  models: Record<
    string,
    { quotaInfo?: { remainingFraction?: number; resetTime?: string } }
  >;
}

async function fetchGoogleLiveQuota(
  accessToken: string,
  projectId: string,
  userAgent: string,
): Promise<GoogleQuotaResponse | null> {
  try {
    const res = await fetchTimeout(
      "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": userAgent,
        },
        body: JSON.stringify({ project: projectId }),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as GoogleQuotaResponse;
  } catch {
    return null;
  }
}

function formatCachedAgeMinutes(updatedAt: number | undefined): string {
  if (!updatedAt) return "";
  const ageMs = Date.now() - updatedAt;
  const mins = Math.round(ageMs / 60_000);
  if (mins < 1) return " (just updated)";
  if (mins === 1) return " (1 min ago)";
  return ` (${mins} min ago)`;
}

async function queryGoogle(ansi = false): Promise<QueryResult> {
  const filePath = join(opencodeConfigDir(), "antigravity-accounts.json");

  if (!existsSync(filePath)) {
    return {
      success: false,
      error:
        "antigravity-accounts.json not found.\n" +
        "Install the opencode-antigravity-auth plugin and sign in to enable Google quota.",
    };
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const file = JSON.parse(content) as { accounts: AntigravityAccount[] };
    const accounts = (file.accounts ?? []).filter((a) => a.email && a.enabled !== false);

    if (!accounts.length)
      return { success: true, output: "No enabled Google accounts found." };

    const outputs: string[] = [];

    for (const account of accounts) {
      const lines: string[] = [`### ${account.email}`];
      const ua = account.fingerprint?.userAgent ?? "antigravity/1.23.2 windows/amd64";

      let usedLive = false;
      try {
        const accessToken = await refreshGoogleAccessToken(account.refreshToken);
        const projectId = account.projectId || account.managedProjectId || "";
        const liveData = await fetchGoogleLiveQuota(accessToken, projectId, ua);

        if (liveData?.models) {
          let firstLive = true;
          for (const model of GOOGLE_LIVE_MODELS) {
            const info =
              liveData.models[model.key] ??
              (model.altKey ? liveData.models[model.altKey] : undefined);
            if (info) {
              if (!firstLive) lines.push("");
              firstLive = false;
              const remain = Math.round((info.quotaInfo?.remainingFraction ?? 0) * 100);
              const reset = formatResetAt(info.quotaInfo?.resetTime ?? "");
              lines.push(model.display);
              lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
              lines.push(`Resets in: ${reset}`);
            }
          }
          usedLive = true;
        }
      } catch {
      }

      if (!usedLive && account.cachedQuota) {
        const age = formatCachedAgeMinutes(account.cachedQuotaUpdatedAt);
        lines.push("", `*(cached${age})*`);
        let firstCached = true;
        for (const group of GOOGLE_CACHED_GROUPS) {
          const info = account.cachedQuota[group.key];
          if (info) {
            if (!firstCached) lines.push("");
            firstCached = false;
            const remain = Math.round(info.remainingFraction * 100);
            const reset = formatResetAt(info.resetTime);
            lines.push(group.display);
            lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
            lines.push(`Resets in: ${reset}`);
          }
        }
      }

      outputs.push(lines.join("\n"));
    }

    return { success: true, output: outputs.join("\n\n") };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// GitHub Copilot
// ============================================================

const COPILOT_VERSION = "0.35.0";
const COPILOT_HEADERS = {
  "User-Agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": `copilot-chat/${COPILOT_VERSION}`,
  "Copilot-Integration-Id": "vscode-chat",
};

interface CopilotQuotaDetail {
  entitlement: number;
  percent_remaining: number;
  remaining: number;
  unlimited: boolean;
  overage_count?: number;
}

interface CopilotUsageData {
  copilot_plan: string;
  quota_reset_date: string;
  quota_snapshots: {
    premium_interactions: CopilotQuotaDetail;
    chat?: CopilotQuotaDetail;
    completions?: CopilotQuotaDetail;
  };
}

interface CopilotPATConfig {
  token: string;
  username: string;
  tier: string;
}

const COPILOT_PLAN_LIMITS: Record<string, number> = {
  free: 50,
  pro: 300,
  "pro+": 1500,
  business: 300,
  enterprise: 1000,
};

function getCopilotPATPath(): string {
  return join(opencodeConfigDir(), "copilot-quota-token.json");
}

function readCopilotPAT(): CopilotPATConfig | null {
  try {
    const p = getCopilotPATPath();
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf-8");
    const cfg = JSON.parse(raw) as CopilotPATConfig;
    return cfg.token && cfg.username && cfg.tier ? cfg : null;
  } catch {
    return null;
  }
}

function formatCopilotQuotaLine(label: string, q: CopilotQuotaDetail, ansi = false): string[] {
  if (q.unlimited) {
    return [
      label,
      `${createProgressBar(100, 26, ansi)} 100% remaining`,
      "Used: Unlimited",
    ];
  }
  const pct = Math.round(q.percent_remaining);
  const used = q.entitlement - q.remaining;
  return [
    label,
    `${createProgressBar(pct, 26, ansi)} ${pct}% remaining`,
    `Used: ${used} / ${q.entitlement}`,
  ];
}

function copilotResetCountdown(date: string): string {
  const diffMs = new Date(date).getTime() - Date.now();
  if (diffMs <= 0) return "resets soon";
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

async function queryCopilotViaOAuth(auth: CopilotAuthData): Promise<string> {
  const oauthToken = auth.refresh || auth.access;
  if (!oauthToken) throw new Error("No OAuth token in Copilot auth data");

  const direct = await fetchTimeout(
    "https://api.github.com/copilot_internal/user",
    {
      headers: {
        Accept: "application/json",
        Authorization: `token ${oauthToken}`,
        ...COPILOT_HEADERS,
      },
    },
  );
  if (direct.ok) return direct.text();

  const exchRes = await fetchTimeout(
    "https://api.github.com/copilot_internal/v2/token",
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${oauthToken}`,
        ...COPILOT_HEADERS,
      },
    },
  );
  if (exchRes.ok) {
    const exchData = (await exchRes.json()) as { token: string };
    const afterExch = await fetchTimeout(
      "https://api.github.com/copilot_internal/user",
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${exchData.token}`,
          ...COPILOT_HEADERS,
        },
      },
    );
    if (afterExch.ok) return afterExch.text();
    throw new Error(`Copilot API error after token exchange (${afterExch.status})`);
  }

  throw new Error(
    "\u26a0\ufe0f GitHub Copilot quota unavailable via OAuth.\n" +
      "OpenCode's OAuth integration doesn't expose the quota API scope.\n\n" +
      "Solution: create a fine-grained PAT with Plan \u2192 Read-only permission and save to:\n" +
      `  ${getCopilotPATPath()}\n` +
      '  {"token": "github_pat_...", "username": "YourUsername", "tier": "pro"}',
  );
}

async function queryCopilot(auth: CopilotAuthData | undefined, ansi = false): Promise<QueryResult | null> {
  const pat = readCopilotPAT();
  if (pat) {
    try {
      const res = await fetchTimeout(
        `https://api.github.com/users/${pat.username}/settings/billing/premium_request/usage`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${pat.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!res.ok) throw new Error(`Billing API error (${res.status})`);

      const billing = (await res.json()) as {
        timePeriod: { year: number; month?: number };
        user: string;
        usageItems: Array<{ sku: string; grossQuantity: number; model?: string; unitType: string }>;
      };

      const limit = COPILOT_PLAN_LIMITS[pat.tier] ?? 300;
      const totalUsed = billing.usageItems
        .filter((i) => i.sku.includes("Premium"))
        .reduce((s, i) => s + i.grossQuantity, 0);
      const remaining = Math.max(0, limit - totalUsed);
      const pct = Math.round((remaining / limit) * 100);
      const period = billing.timePeriod.month
        ? `${billing.timePeriod.year}-${String(billing.timePeriod.month).padStart(2, "0")}`
        : String(billing.timePeriod.year);

      const lines = [
        `Account:        GitHub Copilot (@${billing.user})`,
        "",
        "Premium",
        `${createProgressBar(pct, 26, ansi)} ${pct}% remaining`,
        `Used: ${totalUsed} / ${limit}`,
        "",
        `Billing period: ${period}`,
      ];
      return { success: true, output: lines.join("\n") };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!auth || auth.type !== "oauth" || !auth.refresh) return null;

  try {
    const raw = await queryCopilotViaOAuth(auth);
    const data = JSON.parse(raw) as CopilotUsageData;
    const snaps = data.quota_snapshots;
    const lines = [
      `Account:        GitHub Copilot (${data.copilot_plan})`,
      "",
      ...formatCopilotQuotaLine("Premium", snaps.premium_interactions, ansi),
    ];
    if (snaps.chat && !snaps.chat.unlimited)
      lines.push(...formatCopilotQuotaLine("Chat", snaps.chat, ansi));
    if (snaps.completions && !snaps.completions.unlimited)
      lines.push(...formatCopilotQuotaLine("Completions", snaps.completions, ansi));
    if (snaps.premium_interactions.overage_count)
      lines.push("", `Overage: ${snaps.premium_interactions.overage_count} requests`);
    const cd = copilotResetCountdown(data.quota_reset_date);
    lines.push("", `Resets in: ${cd}`);
    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// OpenCode Go + Zen (merged — shared dashboard config)
// ============================================================
//
// Go quota windows from /workspace/{id}/go SSR
// Zen balance from /workspace/{id}/billing SSR
// Zen per-model costs from /workspace/{id}/usage SSR

const OPENCODE_DASHBOARD_PREFIX = "https://opencode.ai/workspace/";
const OPENCODE_GO_SUFFIX = "/go";
const OPENCODE_ZEN_BILLING_SUFFIX = "/billing";
const OPENCODE_ZEN_USAGE_SUFFIX = "/usage";
const OPENCODE_GO_API_BASE = "https://opencode.ai/zen/go/v1";
const OPENCODE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";

const ZEN_UNITS_PER_DOLLAR = 1e8;

interface OpenCodeGoConfig {
  id?: string;
  name?: string;
  apiKeyEnv?: string;
  workspaceId: string;
  authCookie: string;
}

interface OpenCodeGoModelsResponse {
  data?: Array<{ id?: string }>;
}

interface GoWindowData {
  usagePercent: number;
  resetInSec: number;
}

const GO_SCRAPE_PATTERNS: Array<{
  key: string;
  label: string;
  pctFirst: RegExp;
  resetFirst: RegExp;
}> = [
  {
    key: "rolling",
    label: "5h (rolling)",
    pctFirst: new RegExp(
      String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*\}`,
    ),
    resetFirst: new RegExp(
      String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*\}`,
    ),
  },
  {
    key: "weekly",
    label: "Weekly",
    pctFirst: new RegExp(
      String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*\}`,
    ),
    resetFirst: new RegExp(
      String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*\}`,
    ),
  },
  {
    key: "monthly",
    label: "Monthly",
    pctFirst: new RegExp(
      String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*\}`,
    ),
    resetFirst: new RegExp(
      String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*\}`,
    ),
  },
];

function parseGoWindow(html: string, pattern: (typeof GO_SCRAPE_PATTERNS)[0]): GoWindowData | null {
  const pctMatch = pattern.pctFirst.exec(html);
  if (pctMatch) {
    const usagePercent = Number(pctMatch[1]);
    const resetInSec = Number(pctMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }
  const resetMatch = pattern.resetFirst.exec(html);
  if (resetMatch) {
    const resetInSec = Number(resetMatch[1]);
    const usagePercent = Number(resetMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }
  return null;
}

function parseZenBillingHtml(html: string): {
  balance: number;
  monthlyUsage: number;
  monthlyLimit: number | null;
  reloadAmount: number;
  reloadTrigger: number;
  paymentMethodType: string | null;
  paymentMethodLast4: string | null;
} | null {
  const balance = html.match(/balance:(\d+)/);
  const monthlyUsage = html.match(/monthlyUsage:(\d+)/);
  const monthlyLimit = html.match(/monthlyLimit:(\d+|null)/);
  const reloadAmount = html.match(/reloadAmount:(\d+)/);
  const reloadTrigger = html.match(/reloadTrigger:(\d+)/);
  const payType = html.match(/paymentMethodType:"([^"]+)"/);
  const payLast4 = html.match(/paymentMethodLast4:"([^"]*)"/);

  if (!balance || !monthlyUsage || !reloadAmount || !reloadTrigger) return null;

  return {
    balance: Number(balance[1]),
    monthlyUsage: Number(monthlyUsage[1]),
    monthlyLimit: monthlyLimit ? (monthlyLimit[1] === "null" ? null : Number(monthlyLimit[1])) : null,
    reloadAmount: Number(reloadAmount[1]),
    reloadTrigger: Number(reloadTrigger[1]),
    paymentMethodType: payType ? payType[1] : null,
    paymentMethodLast4: payLast4 ? payLast4[1] : null,
  };
}

function parseZenPayments(html: string): Array<{ amountUsd: number; timeCreated: string }> {
  const payments: Array<{ amountUsd: number; timeCreated: string }> = [];
  const re = /id:"pay_[^"]+",[^]*?amount:(\d+),[^]*?timeCreated:\$R\[\d+\]=new Date\("([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    payments.push({
      amountUsd: Number(m[1]) / ZEN_UNITS_PER_DOLLAR,
      timeCreated: m[2],
    });
  }
  return payments;
}

function parseZenUsageByModel(html: string): Array<{ model: string; costUsd: number; requests: number }> {
  const modelMap = new Map<string, { cost: number; requests: number }>();
  const re = /model:"([^"]+)"[^}]*cost:(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const model = m[1];
    const cost = Number(m[2]) / ZEN_UNITS_PER_DOLLAR;
    const existing = modelMap.get(model) ?? { cost: 0, requests: 0 };
    existing.cost += cost;
    existing.requests += 1;
    modelMap.set(model, existing);
  }
  return [...modelMap.entries()]
    .map(([model, v]) => ({ model, costUsd: v.cost, requests: v.requests }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function zenPaymentLabel(type: string | null, last4: string | null): string {
  if (!type) return "unknown";
  const labels: Record<string, string> = { link: "Stripe Link", card: "Card", bank_account: "Bank" };
  const name = labels[type] ?? type;
  return last4 ? `${name} \u00b7\u00b7\u00b7${last4}` : name;
}

function resolveOpenCodeGoConfigs(): OpenCodeGoConfig[] {
  const jsonPath = join(opencodeConfigDir(), "opencode-go.json");
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const cfg = JSON.parse(raw) as {
        accounts?: Array<Partial<OpenCodeGoConfig>>;
        workspaceId?: string;
        authCookie?: string;
      };

      if (Array.isArray(cfg.accounts) && cfg.accounts.length > 0) {
        return cfg.accounts
          .filter((a): a is OpenCodeGoConfig =>
            typeof a?.workspaceId === "string" && typeof a?.authCookie === "string",
          )
          .map((a) => ({
            id: a.id,
            name: a.name,
            apiKeyEnv: a.apiKeyEnv,
            workspaceId: a.workspaceId,
            authCookie: a.authCookie,
          }));
      }

      if (cfg.workspaceId && cfg.authCookie) {
        return [{ workspaceId: cfg.workspaceId, authCookie: cfg.authCookie }];
      }
    } catch {}
  }

  const envWs = process.env.OPENCODE_GO_WORKSPACE_ID;
  const envCookie = process.env.OPENCODE_GO_AUTH_COOKIE;
  if (envWs && envCookie) return [{ workspaceId: envWs, authCookie: envCookie }];

  return [];
}

async function probeOpenCodeGoApiKey(apiKey: string | undefined): Promise<QueryResult | null> {
  if (!apiKey) return null;

  try {
    const res = await fetchTimeout(`${OPENCODE_GO_API_BASE}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "OpenCode-AllStatus/1.0",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        success: false,
        error: `OpenCode Go API error (${res.status}): ${body.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as OpenCodeGoModelsResponse;
    const models = (data.data ?? []).map((model) => model.id).filter(Boolean) as string[];
    const shown = models.slice(0, 8).join(", ");
    const extra = models.length > 8 ? `, +${models.length - 8} more` : "";
    return {
      success: true,
      output: [
        "API:             reachable",
        `Models:          ${models.length}${shown ? ` (${shown}${extra})` : ""}`,
        "Quota windows:   not exposed by the API key endpoint",
        "Dashboard:       add workspaceId + browser auth cookie to show quota + Zen balance",
      ].join("\n"),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function queryOpenCodeGoZenSingle(config: OpenCodeGoConfig, ansi = false): Promise<QueryResult> {
  const label = config.name || config.id || "OpenCode";

  const headers = {
    "User-Agent": OPENCODE_USER_AGENT,
    Accept: "text/html",
    Cookie: `auth=${config.authCookie}`,
  } as const;

  try {
    const base = OPENCODE_DASHBOARD_PREFIX + encodeURIComponent(config.workspaceId);
    const [goRes, billingRes, usageRes] = await Promise.all([
      fetchTimeout(base + OPENCODE_GO_SUFFIX, { headers }),
      fetchTimeout(base + OPENCODE_ZEN_BILLING_SUFFIX, { headers }),
      fetchTimeout(base + OPENCODE_ZEN_USAGE_SUFFIX, { headers }),
    ]);

    const lines: string[] = [`### ${label}`];

    // Go quota windows
    if (goRes.ok) {
      const goHtml = await goRes.text();
      const now = Date.now();
      let hasGoData = false;
      for (const pattern of GO_SCRAPE_PATTERNS) {
        const data = parseGoWindow(goHtml, pattern);
        if (!data) continue;
        if (hasGoData) lines.push("");
        hasGoData = true;
        const remain = Math.round(100 - Math.max(0, data.usagePercent));
        const resetSec = Math.max(0, data.resetInSec);
        const resetAt = new Date(now + resetSec * 1000).toISOString();
        lines.push(pattern.label);
        lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
        lines.push(`Resets in: ${formatResetAt(resetAt)}`);
      }
    }

    // Zen balance
    let billing: ReturnType<typeof parseZenBillingHtml> = null;
    let billingHtml = "";
    if (billingRes.ok) {
      billingHtml = await billingRes.text();
      billing = parseZenBillingHtml(billingHtml);
    }

    if (billing) {
      const balanceUsd = billing.balance / ZEN_UNITS_PER_DOLLAR;
      const monthlyUsd = billing.monthlyUsage / ZEN_UNITS_PER_DOLLAR;

      if (lines.length > 1) lines.push("");
      lines.push(`Zen balance:    $${balanceUsd.toFixed(2)}`);

      if (billing.paymentMethodType) {
        lines.push(`Payment:        ${zenPaymentLabel(billing.paymentMethodType, billing.paymentMethodLast4)}`);
      }

      if (billing.monthlyLimit !== null && billing.monthlyLimit > 0) {
        const limitUsd = billing.monthlyLimit / ZEN_UNITS_PER_DOLLAR;
        const pct = Math.max(0, Math.min(100, Math.round((monthlyUsd / limitUsd) * 100)));
        const remain = 100 - pct;
        lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% of $${limitUsd.toFixed(0)}/mo`);
      } else {
        lines.push(`Monthly spend:  $${monthlyUsd.toFixed(2)}`);
      }

      const payments = parseZenPayments(billingHtml);
      if (payments.length > 0) {
        const latest = payments.slice(0, 2);
        lines.push("Payments:       " + latest.map((p) => `+$${p.amountUsd.toFixed(2)}`).join(", "));
      }

      // Zen per-model cost breakdown
      if (usageRes.ok) {
        const usageHtml = await usageRes.text();
        const modelCosts = parseZenUsageByModel(usageHtml);
        if (modelCosts.length > 0) {
          const top = modelCosts.slice(0, 5);
          const totalCost = modelCosts.reduce((s, m) => s + m.costUsd, 0);
          lines.push("", `Zen spend:      $${totalCost.toFixed(2)} across ${modelCosts.length} models`);
          for (const m of top) {
            lines.push(`  ${m.model.padEnd(22)} $${m.costUsd.toFixed(4)} (${m.requests})`);
          }
        }
      }
    }

    if (lines.length === 1) {
      return {
        success: false,
        error: `${label}: could not parse any dashboard data.`,
      };
    }

    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      error: `${label}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function queryOpenCodeGoZen(auth: OpenCodeGoAuthData | undefined, ansi = false): Promise<QueryResult | null> {
  const configs = resolveOpenCodeGoConfigs();

  if (configs.length === 0) {
    return probeOpenCodeGoApiKey(auth?.key);
  }

  const results = await Promise.all(configs.map((c) => queryOpenCodeGoZenSingle(c, ansi)));

  const successes = results.filter((r) => r.success && r.output);
  const failures = results.filter((r) => !r.success && r.error);

  if (successes.length === 0 && failures.length > 0) {
    return { success: false, error: failures.map((r) => r.error).join("\n\n") };
  }

  const output = successes.map((r) => r.output).join("\n\n");
  const errorTail = failures.length > 0
    ? `\n\n\u26a0\ufe0f Some accounts failed:\n${failures.map((r) => r.error).join("\n")}`
    : "";

  return { success: true, output: output + errorTail };
}

// ============================================================
// Poe (api.poe.com usage API)
// ============================================================

interface PoeBalanceResponse {
  current_point_balance?: number;
  plan_points_balance?: number;
  addon_point_balance?: number;
  total_balance_usd?: string;
  next_daily_grant_time?: number;
  next_daily_grant_amount?: number;
  next_monthly_grant_time?: number;
  next_monthly_grant_amount?: number;
}

function formatPoeTimestamp(ts: number | undefined): string | null {
  if (!ts) return null;
  const ms = ts > 9_999_999_999_999 ? Math.floor(ts / 1000) : ts;
  const diffMs = ms - Date.now();
  if (diffMs <= 0) return "now";
  return formatDuration(Math.floor(diffMs / 1000));
}

function resolvePoeApiKey(auth: PoeAuthData | undefined): string | null {
  if (auth?.access) return auth.access;
  if (auth?.refresh) return auth.refresh;
  if ((auth as unknown as { key?: string })?.key) return (auth as unknown as { key: string }).key;
  if (process.env.POE_API_KEY) return process.env.POE_API_KEY;

  const jsonPath = join(opencodeConfigDir(), "poe-api-key.json");
  if (!existsSync(jsonPath)) return null;
  try {
    const raw = readFileSync(jsonPath, "utf-8");
    const cfg = JSON.parse(raw) as { apiKey?: string };
    return cfg.apiKey ?? null;
  } catch {
    return null;
  }
}

async function queryPoe(auth: PoeAuthData | undefined, ansi = false): Promise<QueryResult | null> {
  const apiKey = resolvePoeApiKey(auth);
  if (!apiKey) return null;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "OpenCode-AllStatus/1.0",
    };

    const balanceRes = await fetchTimeout("https://api.poe.com/usage/current_balance", { headers });
    if (!balanceRes.ok) {
      const body = await balanceRes.text().catch(() => "");
      throw new Error(`Poe balance API error (${balanceRes.status}): ${body.slice(0, 200)}`);
    }
    const balance = (await balanceRes.json()) as PoeBalanceResponse;

    const lines: string[] = [];

    const monthlyGrant = balance.next_monthly_grant_amount ?? 0;

    const usd = balance.total_balance_usd ? ` ($${balance.total_balance_usd} USD)` : "";
    lines.push(`Balance:        ${balance.current_point_balance ?? "?"} pts${usd}`);

    const daily = formatPoeTimestamp(balance.next_daily_grant_time);
    if (daily) lines.push(`Daily grant:    +${balance.next_daily_grant_amount ?? "?"} (Resets in: ${daily})`);

    if (monthlyGrant > 0) {
      const currentPts = balance.current_point_balance ?? 0;
      const remainPct = Math.round((currentPts / monthlyGrant) * 100);
      lines.push("", "Monthly");
      lines.push(`${createProgressBar(remainPct, 26, ansi)} ${remainPct}% remaining`);
      lines.push(`Points: ${currentPts} / ${monthlyGrant}`);
      const monthly = formatPoeTimestamp(balance.next_monthly_grant_time);
      if (monthly) lines.push(`Resets in: ${monthly}`);
    }

    if (typeof balance.addon_point_balance === "number" && balance.addon_point_balance > 0)
      lines.push("", `Add-on points:  ${balance.addon_point_balance}`);

    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Z.AI Coding Plan
// ============================================================

const ZAI_BASE_URL = "https://api.z.ai";

const ZAI_UNIT_LABELS: Record<number, (n: number) => string> = {
  3: (n) => `${n}-hour rolling`,
  5: (n) => n >= 30 ? `${Math.round(n / 30)}-month` : "Monthly",
  6: (n) => "Weekly",
};

function zaiUnitLabel(unit: number, number_: number): string {
  const fn = ZAI_UNIT_LABELS[unit];
  return fn ? fn(number_) : `Unit ${unit}`;
}

interface ZaiLimitUsageDetail {
  modelCode: string;
  usage: number;
}

interface ZaiLimit {
  type: string;
  unit: number;
  number: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage: number;
  nextResetTime: number;
  usageDetails?: ZaiLimitUsageDetail[];
}

interface ZaiQuotaResponse {
  code: number;
  msg: string;
  data: {
    limits: ZaiLimit[];
    level: string;
  };
  success: boolean;
}

interface ZaiSubscription {
  id: string;
  productName: string;
  status: string;
  valid: string;
  autoRenew: number;
  actualPrice: number;
  renewPrice: number;
  billingCycle: string;
  nextRenewTime: string;
  paymentType: string;
  inCurrentPeriod: boolean;
}

interface ZaiSubscriptionResponse {
  code: number;
  msg: string;
  data: ZaiSubscription[];
  success: boolean;
}

async function queryZai(auth: ZaiAuthData | undefined, ansi = false): Promise<QueryResult | null> {
  if (!auth?.key) return null;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.key}`,
      Accept: "application/json",
      "User-Agent": "OpenCode-AllStatus/1.0",
    };

    const [quotaRes, subRes] = await Promise.all([
      fetchTimeout(`${ZAI_BASE_URL}/api/monitor/usage/quota/limit`, { headers }),
      fetchTimeout(`${ZAI_BASE_URL}/api/biz/subscription/list`, { headers }),
    ]);

    if (!quotaRes.ok) {
      const body = await quotaRes.text().catch(() => "");
      throw new Error(`Z.AI quota API error (${quotaRes.status}): ${body.slice(0, 200)}`);
    }

    const quota = (await quotaRes.json()) as ZaiQuotaResponse;
    if (!quota.success || !quota.data?.limits) {
      throw new Error(`Z.AI quota API returned non-success: ${quota.msg}`);
    }

    let planLabel = `GLM Coding (${quota.data.level ?? "unknown"})`;
    let validityLine = "";
    let priceLine = "";
    let renewalLine = "";

    if (subRes.ok) {
      const subData = (await subRes.json()) as ZaiSubscriptionResponse;
      const active = (subData.data ?? []).find(
        (s) => s.status === "VALID" && s.inCurrentPeriod,
      );
      if (active) {
        planLabel = active.productName;
        const priceUsd = `$${active.actualPrice?.toFixed(2) ?? "?"}`;
        priceLine = `Price:           ${priceUsd}/${active.billingCycle ?? "?"}`;
        renewalLine = active.autoRenew
          ? `Auto-renews:     ${active.nextRenewTime ?? "unknown"}`
          : `Expires:         ${active.nextRenewTime ?? "unknown"}`;
        const parts = active.valid?.split("-", 2) ?? [];
        if (parts.length === 2) {
          validityLine = `Valid:           ${parts[0].trim()} to ${parts[1].trim()}`;
        }
      }
    }

    const lines: string[] = [`Plan:           ${planLabel}`];
    if (priceLine) lines.push(priceLine);
    if (validityLine) lines.push(validityLine);
    if (renewalLine) lines.push(renewalLine);

    const limits = [...quota.data.limits].sort((a, b) => {
      const weight = (u: number) => (u === 3 ? 1 : u === 6 ? 2 : u === 5 ? 3 : 99);
      return weight(a.unit) - weight(b.unit);
    });
    for (const limit of limits) {
      const remain = Math.round(100 - Math.max(0, Math.min(100, limit.percentage)));
      const label = zaiUnitLabel(limit.unit, limit.number);

      lines.push("", label);

      if (limit.type === "TIME_LIMIT" && typeof limit.remaining === "number" && typeof limit.usage === "number") {
        const total = limit.remaining + limit.usage;
        lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
        lines.push(`Used: ${limit.usage} / ${total}`);
      } else {
        lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
      }

      const resetAt = new Date(limit.nextResetTime).toISOString();
      lines.push(`Resets in: ${formatResetAt(resetAt)}`);

      if (limit.usageDetails?.length) {
        const withUsage = limit.usageDetails.filter((d) => d.usage > 0);
        if (withUsage.length) {
          lines.push(
            "  " + withUsage.map((d) => `${d.modelCode}: ${d.usage}`).join(", "),
          );
        }
      }
    }

    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// xAI/Grok (auth validity check — no public usage API)
// ============================================================

async function queryXai(auth: XaiAuthData | undefined): Promise<QueryResult | null> {
  if (!auth || auth.type !== "oauth" || !auth.access) return null;
  if (auth.expires && auth.expires < Date.now())
    return { success: false, error: "\u26a0\ufe0f xAI token expired." };

  try {
    const res = await fetchTimeout("https://api.x.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${auth.access}`,
        Accept: "application/json",
        "x-grok-source": "opencode-allstatus",
      },
    });

    if (!res.ok) throw new Error(`xAI API error (${res.status})`);

    return {
      success: true,
      output: [
        "Auth:           valid",
        "Usage API:      xAI does not expose a public usage endpoint",
      ].join("\n"),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// MiniMax Token Plan (minimax.io — Anthropic-compatible API)
// ============================================================
//
//   Quota source:    GET https://api.minimax.io/v1/token_plan/remains
//   Auth:            Bearer sk-cp-…  (Token Plan Subscription Key)
//   Response shape:  model_remains[]  with 5h + 7-day windows per bucket
//   Buckets:         "general" (text/M3), "video", "image", "speech", "audio"
//   Scope:           chat/agent text usage only — the "video" bucket is
//                    filtered out below as it is out of scope for this
//                    plugin. Image/speech/audio buckets are kept for now
//                    because they typically aren't returned by the account.

const MINIMAX_BASE_URL = "https://api.minimax.io";
const MINIMAX_PLAN_LABELS: Record<string, string> = {
  general: "General (text/M3)",
  image: "Image",
  speech: "Speech",
  audio: "Audio",
};
const MINIMAX_EXCLUDED_BUCKETS = new Set<string>(["video"]);

interface MiniMaxWindowBucket {
  model_name?: string;
  start_time?: number;
  end_time?: number;
  remains_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  current_interval_remaining_percent?: number;
  current_interval_status?: number;
  weekly_start_time?: number;
  weekly_end_time?: number;
  weekly_remains_time?: number;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  current_weekly_remaining_percent?: number;
  current_weekly_status?: number;
}

interface MiniMaxRemainsResponse {
  model_remains?: MiniMaxWindowBucket[];
  base_resp?: { status_code?: number; status_msg?: string };
}

function minimaxWindowLabel(bucketName: string, kind: "interval" | "weekly"): string {
  const label = MINIMAX_PLAN_LABELS[bucketName] ?? bucketName;
  return kind === "interval" ? `${label} — 5h` : `${label} — 7-day`;
}

function minimaxResetSeconds(raw: number | undefined): number | undefined {
  if (typeof raw !== "number" || raw <= 0) return undefined;
  if (raw > 86_400) return Math.floor(raw / 1000);
  return Math.floor(raw);
}

function formatMiniMaxWindow(
  bucketName: string,
  kind: "interval" | "weekly",
  pct: number | undefined,
  used: number | undefined,
  total: number | undefined,
  resetRaw: number | undefined,
  status: number | undefined,
  ansi: boolean,
): string[] {
  const remain = Math.max(0, Math.min(100, Math.round(pct ?? 100)));
  const title = minimaxWindowLabel(bucketName, kind);
  const throttled = status !== undefined && status !== 1;
  const lines: string[] = [title];

  if (throttled) lines.push(`\u26a0\ufe0f throttled (status=${status})`);

  lines.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);

  if (typeof total === "number" && total > 0 && typeof used === "number") {
    lines.push(`Used: ${used} / ${total}`);
  }

  const resetSec = minimaxResetSeconds(resetRaw);
  if (resetSec !== undefined && resetSec > 0) {
    lines.push(`Resets in: ${formatDuration(resetSec)}`);
  }

  return lines;
}

function minimaxBucketSortKey(name: string): number {
  if (name === "general") return 0;
  return 1;
}

async function queryMiniMax(
  auth: MiniMaxAuthData | undefined,
  ansi = false,
): Promise<QueryResult | null> {
  if (!auth?.key) return null;
  if (!auth.key.startsWith("sk-cp-")) {
    return {
      success: false,
      error:
        `\u26a0\ufe0f Key is not a Token Plan subscription key (expected sk-cp- prefix).\n` +
        `Use the Token Plan key from MiniMax Console \u2192 Billing \u2192 Token Plan.`,
    };
  }

  try {
    const res = await fetchTimeout(`${MINIMAX_BASE_URL}/v1/token_plan/remains`, {
      headers: {
        Authorization: `Bearer ${auth.key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "OpenCode-AllStatus/1.0",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`MiniMax API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as MiniMaxRemainsResponse;

    if (data.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax API error: ${data.base_resp.status_msg ?? `code ${data.base_resp.status_code}`}`,
      );
    }

    const buckets = (data.model_remains ?? [])
      .filter((b) => typeof b.model_name === "string")
      .filter((b) => !MINIMAX_EXCLUDED_BUCKETS.has(b.model_name!))
      .sort((a, b) => {
        const ka = minimaxBucketSortKey(a.model_name!);
        const kb = minimaxBucketSortKey(b.model_name!);
        if (ka !== kb) return ka - kb;
        return a.model_name!.localeCompare(b.model_name!);
      });

    if (buckets.length === 0) {
      return {
        success: true,
        output: [
          "Account:        MiniMax Token Plan",
          "",
          "Plan:           Token Plan (no active buckets returned)",
        ].join("\n"),
      };
    }

    const cells: string[] = [];
    for (const b of buckets) {
      const name = b.model_name!;

      const intervalLines = formatMiniMaxWindow(
        name,
        "interval",
        b.current_interval_remaining_percent,
        b.current_interval_usage_count,
        b.current_interval_total_count,
        b.remains_time,
        b.current_interval_status,
        ansi,
      );

      const weeklyLines = formatMiniMaxWindow(
        name,
        "weekly",
        b.current_weekly_remaining_percent,
        b.current_weekly_usage_count,
        b.current_weekly_total_count,
        b.weekly_remains_time,
        b.current_weekly_status,
        ansi,
      );

      const block = [`### ${name}`, ...intervalLines, "", ...weeklyLines].join("\n");
      cells.push(block);
    }

    return { success: true, output: cells.join("\n\n") };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Grid rendering
// ============================================================

interface GridCell {
  title: string;
  lines: string[];
}

function shortProvider(title: string): string {
  return title.replace(/ (Account Quota|Coding Plan)$/i, "");
}

function cellTitle(providerTitle: string, subTitle: string): string {
  const short = shortProvider(providerTitle);
  if (subTitle.toLowerCase().startsWith(short.toLowerCase())) {
    return subTitle;
  }
  return `${short} \u2014 ${subTitle}`;
}

function collect(
  result: QueryResult | null,
  providerTitle: string,
  cells: GridCell[],
  errors: string[],
): void {
  if (!result) return;
  if (result.success && result.output) {
    const parts = result.output.split(/\n\n(?=### )/);
    if (parts.length > 1) {
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^### (.+)\n?([\s\S]*)/);
        if (m) {
          const subTitle = m[1].trim();
          const body = (m[2] ?? "").split("\n");
          cells.push({ title: cellTitle(providerTitle, subTitle), lines: body });
        } else {
          cells.push({ title: providerTitle, lines: trimmed.split("\n") });
        }
      }
    } else {
      cells.push({ title: providerTitle, lines: result.output.split("\n") });
    }
  } else if (result.error) {
    errors.push(`${providerTitle}:\n${result.error}`);
  }
}

// ============================================================
// Threshold alert extraction
// ============================================================

function extractAlerts(cells: GridCell[], threshold = 25): string[] {
  const alerts: string[] = [];
  const worst = new Map<string, number>();

  for (const cell of cells) {
    let cellMin = 101;
    for (const line of cell.lines) {
      const m = line.match(/(\d+)% (?:remaining|of)/);
      if (m) {
        const pct = parseInt(m[1]);
        cellMin = Math.min(cellMin, pct);
      }
    }
    if (cellMin <= threshold && cellMin > 0) {
      worst.set(cell.title, cellMin);
    }
  }

  for (const [title, pct] of worst) {
    alerts.push(`${title}: ${pct}%`);
  }

  return alerts;
}

// ============================================================
// JSON serialization
// ============================================================

function cellsToJson(cells: GridCell[], alerts: string[], errors: string[]): string {
  return JSON.stringify(
    {
      cells: cells.map((c) => ({ title: c.title, lines: c.lines })),
      alerts: alerts.length > 0 ? alerts : undefined,
      errors: errors.length > 0 ? errors : undefined,
    },
    null,
    2,
  );
}

// ============================================================
// Rendering
// ============================================================

const CELL_W = 46;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function padLine(s: string, w: number): string {
  const visual = stripAnsi(s);

  if (visual.length > w) {
    const cut = visual.slice(0, Math.max(0, w - 1)) + "\u2026";
    return cut + " ".repeat(Math.max(0, w - cut.length));
  }

  return s + " ".repeat(Math.max(0, w - visual.length));
}

function renderGrid(cells: GridCell[]): string {
  const out: string[] = [];
  for (let r = 0; r * 2 < cells.length; r++) {
    const left = cells[r * 2];
    const right = cells[r * 2 + 1];

    const rawLT = left ? ` ${left.title} ` : "";
    const rawRT = right ? ` ${right.title} ` : "";
    const maxTitleW = CELL_W - 4;
    const lTitle = rawLT.length > maxTitleW ? rawLT.slice(0, maxTitleW) + "\u2026 " : rawLT;
    const rTitle = rawRT.length > maxTitleW ? rawRT.slice(0, maxTitleW) + "\u2026 " : rawRT;
    const lHdr =
      "\u2500\u2500" +
      lTitle +
      "\u2500".repeat(Math.max(0, CELL_W - 2 - lTitle.length));
    const rHdr = right
      ? "\u2500\u2500" +
        rTitle +
        "\u2500".repeat(Math.max(0, CELL_W - 2 - rTitle.length))
      : "\u2500".repeat(CELL_W);
    out.push("\u250C" + lHdr + "\u252C" + rHdr + "\u2510");

    const lLines = left ? [...left.lines] : [];
    const rLines = right ? [...right.lines] : [];
    const h = Math.max(lLines.length, rLines.length);
    for (let i = 0; i < h; i++) {
      const lContent = " " + padLine(lLines[i] ?? "", CELL_W - 1);
      const rContent = " " + padLine(rLines[i] ?? "", CELL_W - 1);
      out.push("\u2502" + lContent + "\u2502" + rContent + "\u2502");
    }

    out.push(
      "\u2514" +
        "\u2500".repeat(CELL_W) +
        "\u2534" +
        "\u2500".repeat(CELL_W) +
        "\u2518",
    );
    out.push("");
  }
  return out.join("\n");
}

// ============================================================
// Plugin entry point
// ============================================================

export const MyStatusPlugin: Plugin = async () => ({
  tool: {
    mystatus: tool({
      description:
        "Query quota usage for all configured AI platforms. Returns remaining quota, usage stats, and reset countdowns. Supports OpenAI, Anthropic, Google (Antigravity), GitHub Copilot, OpenCode Go+Zen, Poe, Z.AI (GLM Coding Plan), xAI/Grok, and MiniMax Token Plan.",
      args: {
        format: tool.schema.string().optional(),
        threshold: tool.schema.number().optional(),
      },
      async execute(args) {
        const format = args.format ?? "ansi";
        const threshold = args.threshold ?? 25;
        const useAnsi = format !== "json";

        const authPath = authJsonPath();
        let auth: AuthData = {};
        try {
          const raw = await readFile(authPath, "utf-8");
          auth = JSON.parse(raw) as AuthData;
        } catch (err) {
          return `\u274c Failed to read auth file: ${authPath}\n${err instanceof Error ? err.message : String(err)}`;
        }

        const [openaiResult, anthropicResult, googleResult, copilotResult, goZenResult, poeResult, zaiResult, xaiResult, minimaxResult] =
          await Promise.all([
            queryOpenAI(auth.openai, useAnsi),
            queryAnthropic(auth.anthropic, useAnsi),
            queryGoogle(useAnsi),
            queryCopilot(auth["github-copilot"], useAnsi),
            queryOpenCodeGoZen(auth["opencode-go"], useAnsi),
            queryPoe(auth.poe, useAnsi),
            queryZai(auth["zai-coding-plan"], useAnsi),
            queryXai(auth["xai-oauth"]),
            queryMiniMax(auth["minimax-coding-plan"], useAnsi),
          ]);

        const cells: GridCell[] = [];
        const errors: string[] = [];

        collect(openaiResult, "OpenAI Account Quota", cells, errors);
        collect(anthropicResult, "Anthropic Account Quota", cells, errors);
        collect(googleResult, "Google Account Quota", cells, errors);
        collect(copilotResult, "GitHub Copilot Account Quota", cells, errors);
        collect(goZenResult, "OpenCode Go+Zen Account Quota", cells, errors);
        collect(poeResult, "Poe Account Quota", cells, errors);
        collect(zaiResult, "Z.AI Coding Plan", cells, errors);
        collect(xaiResult, "xAI/Grok", cells, errors);
        collect(minimaxResult, "MiniMax Token Plan", cells, errors);

        cells.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

        if (cells.length === 0) {
          return errors.length
            ? `\u274c Failed to query:\n${errors.join("\n\n")}`
            : "No accounts found.";
        }

        // JSON output mode
        if (format === "json") {
          const alerts = extractAlerts(cells, threshold);
          return cellsToJson(cells, alerts, errors);
        }

        // Alert threshold scan
        const alerts = extractAlerts(cells, threshold);

        // Grid rendering
        let output = renderGrid(cells).trimEnd();

        // Threshold alerts footer
        if (alerts.length > 0) {
          if (useAnsi) {
            output += `\n\n${ANSI_BOLD}${ANSI_RED}\u26a0\ufe0f Low quota alerts:${ANSI_RESET}`;
            for (const alert of alerts) {
              output += `\n${ANSI_RED}  \u2022 ${alert}${ANSI_RESET}`;
            }
          } else {
            output += `\n\n\u26a0\ufe0f Low quota alerts:`;
            for (const alert of alerts) {
              output += `\n  \u2022 ${alert}`;
            }
          }
        }

        if (errors.length) {
          output += `\n\n\u274c Failed to query:\n${errors.join("\n\n")}`;
        }

        return output;
      },
    }),
  },
});
