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
 *   - xAI/Grok    (SuperGrok free credits + dev API)  auth.json → xai/xai-oauth (dev) + ~/.grok/auth.json (consumer, auto-refreshed) via cli-chat-proxy /v1/billing[?format=credits]
 *   - MiniMax     (Token Plan)              auth.json → minimax-coding-plan (Anthropic-compatible)
 *   - NanoGPT     (balance + subscription)  auth.json → nano-gpt OR nanogpt-keys.json
 *   - StepFun     (Token Plan)              stepfun-cookies.json → dashboard API
 *   - QwenCloud   (Token Plan)              qwencloud-cookies.json → dashboard API
 *   - BytePlus    (Ark Coding Plan)         byteplus-cookies.json → console API
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
import { existsSync, readFileSync, writeFileSync } from "fs";
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

// A single quota window (the things we track, sort, and trend on).
interface QuotaWindow {
  label: string; // "5-hour limit", "G3 Pro", "Weekly"
  remaining: number; // 0-100
  resetAt?: string; // ISO timestamp
  resetInSec?: number; // seconds-until-reset (alternative to resetAt)
  resetText?: string; // pre-formatted countdown (e.g. Copilot "5d 3h")
  suffix?: string; // overrides the "NN% remaining" text after the bar
  detail?: string[]; // lines after the bar, before the reset line
  extra?: string[]; // lines after the reset line
  warn?: string; // a warning line shown under the label (throttled, etc.)
}

// One rendered panel. Free-form header/footer lines plus structured windows.
interface ProviderCard {
  subtitle?: string; // sub-account (email, "Alt 1"); composed with provider title
  note?: string; // e.g. "(cached 3m ago)" shown at the top
  header?: string[]; // "Account: …", "Plan: …"
  windows?: QuotaWindow[];
  footer?: string[]; // Zen balance, payments, model spend, etc.
}

interface QueryResult {
  success: boolean;
  cards?: ProviderCard[]; // structured output (preferred)
  output?: string; // legacy free-form fallback
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

interface NanoGptAuthData {
  type: string;
  key?: string;
}

interface NanoGptCredential {
  source: "native" | "multi-auth";
  label?: string;
  key: string;
  cooldownUntil?: number;
}

interface NanoGptStoredKey {
  id?: string;
  label?: string;
  key?: string;
  enabled?: boolean;
  cooldownUntil?: number;
}

interface NanoGptStoredKeysFile {
  version?: number;
  keys?: NanoGptStoredKey[];
}

interface AuthData {
  openai?: OpenAIAuthData;
  anthropic?: AnthropicAuthData;
  "github-copilot"?: CopilotAuthData;
  "opencode-go"?: OpenCodeGoAuthData;
  poe?: PoeAuthData;
  "zai-coding-plan"?: ZaiAuthData;
  "xai-oauth"?: XaiAuthData;
  xai?: XaiAuthData;
  "minimax-coding-plan"?: MiniMaxAuthData;
  "nano-gpt"?: NanoGptAuthData;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoffDelay = (attempt: number) => 300 * 2 ** attempt + Math.floor(Math.random() * 150);

// GET-style fetch with a per-attempt timeout and bounded retries. Retries on
// 429/5xx (honoring Retry-After) and fast network errors with exponential
// backoff + jitter. Timeouts are NOT retried (they'd multiply latency).
async function fetchTimeout(
  url: string,
  options: RequestInit,
  ms = 10_000,
  retries = 2,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : backoffDelay(attempt);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request timed out after ${ms / 1000}s`);
      }
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(id);
    }
  }
  throw lastErr ?? new Error("fetch failed after retries");
}

// ============================================================
// Paths
// ============================================================

function authJsonPath(): string {
  return opencodeDataFile("auth.json");
}

function opencodeDataFile(name: string): string {
  return join(homedir(), ".local", "share", "opencode", name);
}

function nanoGptMultiAuthKeysPath(): string {
  return opencodeDataFile("nanogpt-keys.json");
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

function openAIWindow(w: OpenAIWindowData): QuotaWindow {
  const sec = w.limit_window_seconds;
  const label =
    sec >= 86400
      ? `${Math.round(sec / 86400)}-day limit`
      : `${Math.round(sec / 3600)}-hour limit`;
  return { label, remaining: Math.round(100 - w.used_percent), resetInSec: w.reset_after_seconds };
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

    const header: string[] = [
      `Account:        ${data.email ?? email ?? "unknown"}`,
      `Plan:           ChatGPT ${data.plan_type}`,
    ];

    const credits = data.credits;
    if (credits) {
      if (credits.unlimited) {
        header.push("Credits:        unlimited");
      } else if (credits.has_credits || (credits.balance && credits.balance !== "0")) {
        header.push(`Credits:        ${credits.balance ?? "?"}`);
      }
      if (credits.overage_limit_reached) header.push("Overage:        \u26a0\ufe0f limit reached");
    }

    const windows: QuotaWindow[] = [];
    if (data.rate_limit?.primary_window) windows.push(openAIWindow(data.rate_limit.primary_window));
    if (data.rate_limit?.secondary_window) windows.push(openAIWindow(data.rate_limit.secondary_window));

    const footer: string[] = [];
    if (data.rate_limit?.limit_reached) {
      const reason = data.rate_limit_reached_type?.type
        ? ` (${data.rate_limit_reached_type.type})`
        : "";
      footer.push(`\u26a0\ufe0f Rate limit reached!${reason}`);
      const resetCredits = data.rate_limit_reset_credits?.available_count ?? 0;
      if (resetCredits > 0) footer.push(`Reset credits available: ${resetCredits}`);
    }

    return {
      success: true,
      cards: [{ header, windows, footer: footer.length ? footer : undefined }],
    };
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

function anthropicWindow(label: string, w: AnthropicWindow): QuotaWindow {
  return { label, remaining: Math.round(100 - w.utilization), resetAt: w.resets_at };
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

    const header = ["Account:        Claude Pro/Max"];
    const windows: QuotaWindow[] = [];

    if (data.five_hour) windows.push(anthropicWindow("5-hour limit", data.five_hour));
    if (data.seven_day) windows.push(anthropicWindow("7-day limit", data.seven_day));

    for (const { key, label } of ANTHROPIC_MODEL_WINDOWS) {
      const w = data[key] as AnthropicWindow | null | undefined;
      if (w && typeof w.utilization === "number") windows.push(anthropicWindow(label, w));
    }

    const footer: string[] = [];
    const extra = data.extra_usage;
    if (extra?.is_enabled) {
      const cur = extra.currency ?? "USD";
      const used = extra.used_credits ?? 0;
      const limit = extra.monthly_limit;
      footer.push("Extra usage (overage)");
      if (typeof limit === "number" && limit > 0) {
        const util = Math.round(extra.utilization ?? (used / limit) * 100);
        const remain = Math.max(0, 100 - util);
        footer.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
        footer.push(`Used: ${used}/${limit} ${cur}`);
      } else {
        footer.push(`Used: ${used} ${cur}`);
      }
    }

    if (!data.five_hour && !data.seven_day) {
      footer.push("(No rolling-window limits found \u2014 may be API-key plan or unlimited)");
    }

    return {
      success: true,
      cards: [{ header, windows, footer: footer.length ? footer : undefined }],
    };
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

// Antigravity quota is pooled per model *family*, not per individual model, and
// Google rotates the exact model identifiers frequently (e.g. gemini-3-pro ->
// gemini-3.1-pro-high/low; flash variants and image models come and go). Matching
// hard-coded keys therefore silently drops or misreports quota. Instead we
// classify every model the live API returns into the same three families the
// auth plugin caches (gemini-pro / gemini-flash / claude) and aggregate
// conservatively. This keeps the live and cached paths consistent and resilient
// to renames. The grouping mirrors opencode-antigravity-auth's classifyQuotaGroup.
type AntigravityGroupKey = "gemini-pro" | "gemini-flash" | "claude" | "gpt-oss";

const GOOGLE_QUOTA_GROUPS: Array<{ key: AntigravityGroupKey; display: string }> = [
  { key: "gemini-pro", display: "Gemini Pro" },
  { key: "gemini-flash", display: "Gemini Flash" },
  { key: "claude", display: "Claude" },
  { key: "gpt-oss", display: "GPT-OSS" },
];

interface AntigravityGroupAgg {
  remainingFraction?: number;
  resetTime?: string;
  modelCount: number;
}

// Classify a retrieveUserQuota bucket modelId into a user-facing family.
// Internal "chat_*"/"tab_*" helper models carry no user quota and are dropped.
// Order matters: Claude and GPT-OSS are matched before the Gemini families.
function classifyAntigravityGroup(modelId: string): AntigravityGroupKey | null {
  const m = modelId.toLowerCase();
  if (m.startsWith("chat_") || m.startsWith("tab_")) return null;
  if (m.includes("claude")) return "claude";
  if (m.includes("gpt-oss") || m.includes("gpt")) return "gpt-oss";
  if (!m.includes("gemini")) return null;
  return m.includes("flash") ? "gemini-flash" : "gemini-pro";
}

// Fold per-model quota buckets into family buckets using the conservative
// (minimum) remaining fraction and the earliest reset time, matching the auth
// plugin's aggregateQuota so the live path agrees with the cached snapshot.
function aggregateAntigravityQuota(
  buckets: RetrieveUserQuotaResponse["buckets"] | undefined,
): Partial<Record<AntigravityGroupKey, AntigravityGroupAgg>> {
  const groups: Partial<Record<AntigravityGroupKey, AntigravityGroupAgg>> = {};
  for (const bucket of buckets ?? []) {
    const modelId = bucket.modelId;
    if (!modelId) continue;
    const group = classifyAntigravityGroup(modelId);
    if (!group) continue;

    const rawFraction = bucket.remainingFraction;
    const fraction =
      typeof rawFraction === "number" && Number.isFinite(rawFraction)
        ? Math.max(0, Math.min(1, rawFraction))
        : undefined;
    const resetTime = bucket.resetTime;
    const existing = groups[group];

    const nextRemaining =
      fraction === undefined
        ? existing?.remainingFraction
        : existing?.remainingFraction === undefined
          ? fraction
          : Math.min(existing.remainingFraction, fraction);

    let nextResetTime = existing?.resetTime;
    const ts = resetTime ? Date.parse(resetTime) : Number.NaN;
    if (Number.isFinite(ts)) {
      const existingTs = existing?.resetTime ? Date.parse(existing.resetTime) : Number.NaN;
      if (!existing?.resetTime || !Number.isFinite(existingTs) || ts < existingTs) {
        nextResetTime = resetTime;
      }
    }

    groups[group] = {
      remainingFraction: nextRemaining,
      resetTime: nextResetTime,
      modelCount: (existing?.modelCount ?? 0) + 1,
    };
  }
  return groups;
}

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

interface RetrieveUserQuotaResponse {
  buckets?: Array<{
    modelId?: string;
    remainingFraction?: number;
    remainingAmount?: string;
    resetTime?: string;
    tokenType?: string;
  }>;
}

// The Cloud Code ClientMetadata.platform field is a typed enum; the string
// "MACOS"/"WINDOWS" used elsewhere is rejected with HTTP 400 here, which is why
// project resolution silently failed and quota fell back to the generic catalog.
function googlePlatformEnum(): string {
  if (process.platform === "win32") return "WINDOWS_AMD64";
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "DARWIN_ARM64" : "DARWIN_AMD64";
  }
  return process.arch === "arm64" ? "LINUX_ARM64" : "LINUX_AMD64";
}

// Resolve the account's managed cloudaicompanion project via loadCodeAssist.
// retrieveUserQuota returns the generic (always-100%) catalog without it.
async function resolveGoogleProject(accessToken: string, fallback: string): Promise<string> {
  const platform = googlePlatformEnum();
  try {
    const res = await fetchTimeout(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "google-api-nodejs-client/9.15.1",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": `{"ideType":"ANTIGRAVITY","platform":"${platform}","pluginType":"GEMINI"}`,
        },
        body: JSON.stringify({
          metadata: { ideType: "ANTIGRAVITY", platform, pluginType: "GEMINI" },
        }),
      },
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      cloudaicompanionProject?: string | { id?: string };
    };
    const proj =
      typeof data.cloudaicompanionProject === "string"
        ? data.cloudaicompanionProject
        : data.cloudaicompanionProject?.id;
    return proj || fallback;
  } catch {
    return fallback;
  }
}

async function fetchGoogleLiveQuota(
  accessToken: string,
  projectId: string,
  userAgent: string,
): Promise<RetrieveUserQuotaResponse | null> {
  try {
    const res = await fetchTimeout(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": userAgent,
        },
        body: JSON.stringify(projectId ? { project: projectId } : {}),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as RetrieveUserQuotaResponse;
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

    const cards: ProviderCard[] = [];

    for (const account of accounts) {
      const ua = account.fingerprint?.userAgent ?? "antigravity/1.23.2 windows/amd64";
      const windows: QuotaWindow[] = [];
      let note: string | undefined;

      let usedLive = false;
      try {
        const accessToken = await refreshGoogleAccessToken(account.refreshToken);
        const knownProject = account.managedProjectId || account.projectId || "";
        const projectId = knownProject || (await resolveGoogleProject(accessToken, ""));
        const liveData = await fetchGoogleLiveQuota(accessToken, projectId, ua);

        if (liveData?.buckets) {
          const grouped = aggregateAntigravityQuota(liveData.buckets);
          for (const group of GOOGLE_QUOTA_GROUPS) {
            const info = grouped[group.key];
            if (info && info.remainingFraction !== undefined) {
              windows.push({
                label: group.display,
                remaining: Math.round(info.remainingFraction * 100),
                resetAt: info.resetTime,
              });
            }
          }
          // Only treat live data as authoritative if it actually produced quota
          // groups; otherwise fall through to the cached snapshot below.
          usedLive = windows.length > 0;
        }
      } catch {
      }

      if (!usedLive && account.cachedQuota) {
        note = `cached${formatCachedAgeMinutes(account.cachedQuotaUpdatedAt)}`;
        for (const group of GOOGLE_QUOTA_GROUPS) {
          const info = account.cachedQuota[group.key];
          if (info) {
            windows.push({
              label: group.display,
              remaining: Math.round(info.remainingFraction * 100),
              resetAt: info.resetTime,
            });
          }
        }
      }

      cards.push({ subtitle: account.email, note, windows });
    }

    return { success: true, cards };
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

function copilotWindow(label: string, q: CopilotQuotaDetail): QuotaWindow {
  if (q.unlimited) return { label, remaining: 100, detail: ["Used: Unlimited"] };
  const pct = Math.round(q.percent_remaining);
  const used = q.entitlement - q.remaining;
  return { label, remaining: pct, detail: [`Used: ${used} / ${q.entitlement}`] };
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

      return {
        success: true,
        cards: [
          {
            header: [`Account:        GitHub Copilot (@${billing.user})`],
            windows: [
              { label: "Premium", remaining: pct, detail: [`Used: ${totalUsed} / ${limit}`] },
            ],
            footer: [`Billing period: ${period}`],
          },
        ],
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!auth || auth.type !== "oauth" || !auth.refresh) return null;

  try {
    const raw = await queryCopilotViaOAuth(auth);
    const data = JSON.parse(raw) as CopilotUsageData;
    const snaps = data.quota_snapshots;

    const windows: QuotaWindow[] = [copilotWindow("Premium", snaps.premium_interactions)];
    if (snaps.chat && !snaps.chat.unlimited) windows.push(copilotWindow("Chat", snaps.chat));
    if (snaps.completions && !snaps.completions.unlimited)
      windows.push(copilotWindow("Completions", snaps.completions));

    const footer: string[] = [];
    if (snaps.premium_interactions.overage_count)
      footer.push(`Overage: ${snaps.premium_interactions.overage_count} requests`, "");
    footer.push(`Resets in: ${copilotResetCountdown(data.quota_reset_date)}`);

    return {
      success: true,
      cards: [
        { header: [`Account:        GitHub Copilot (${data.copilot_plan})`], windows, footer },
      ],
    };
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

    const windows: QuotaWindow[] = [];

    // Go quota windows
    if (goRes.ok) {
      const goHtml = await goRes.text();
      for (const pattern of GO_SCRAPE_PATTERNS) {
        const data = parseGoWindow(goHtml, pattern);
        if (!data) continue;
        windows.push({
          label: pattern.label,
          remaining: Math.round(100 - Math.max(0, data.usagePercent)),
          resetInSec: Math.max(0, data.resetInSec),
        });
      }
    }

    // Zen balance / spend footer
    const footer: string[] = [];
    let billing: ReturnType<typeof parseZenBillingHtml> = null;
    let billingHtml = "";
    if (billingRes.ok) {
      billingHtml = await billingRes.text();
      billing = parseZenBillingHtml(billingHtml);
    }

    if (billing) {
      const balanceUsd = billing.balance / ZEN_UNITS_PER_DOLLAR;
      const monthlyUsd = billing.monthlyUsage / ZEN_UNITS_PER_DOLLAR;

      footer.push(`Zen balance:    $${balanceUsd.toFixed(2)}`);

      if (billing.paymentMethodType) {
        footer.push(`Payment:        ${zenPaymentLabel(billing.paymentMethodType, billing.paymentMethodLast4)}`);
      }

      if (billing.monthlyLimit !== null && billing.monthlyLimit > 0) {
        const limitUsd = billing.monthlyLimit / ZEN_UNITS_PER_DOLLAR;
        const pct = Math.max(0, Math.min(100, Math.round((monthlyUsd / limitUsd) * 100)));
        const remain = 100 - pct;
        footer.push(`${createProgressBar(remain, 26, ansi)} ${remain}% of $${limitUsd.toFixed(0)}/mo`);
      } else {
        footer.push(`Monthly spend:  $${monthlyUsd.toFixed(2)}`);
      }

      const payments = parseZenPayments(billingHtml);
      if (payments.length > 0) {
        const latest = payments.slice(0, 2);
        footer.push("Payments:       " + latest.map((p) => `+$${p.amountUsd.toFixed(2)}`).join(", "));
      }

      // Zen per-model cost breakdown
      if (usageRes.ok) {
        const usageHtml = await usageRes.text();
        const modelCosts = parseZenUsageByModel(usageHtml);
        if (modelCosts.length > 0) {
          const top = modelCosts.slice(0, 5);
          const totalCost = modelCosts.reduce((s, m) => s + m.costUsd, 0);
          footer.push("", `Zen spend:      $${totalCost.toFixed(2)} across ${modelCosts.length} models`);
          for (const m of top) {
            footer.push(`  ${m.model.padEnd(22)} $${m.costUsd.toFixed(4)} (${m.requests})`);
          }
        }
      }
    }

    if (windows.length === 0 && footer.length === 0) {
      return {
        success: false,
        error: `${label}: could not parse any dashboard data.`,
      };
    }

    return {
      success: true,
      cards: [{ subtitle: label, windows, footer: footer.length ? footer : undefined }],
    };
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

  const cards: ProviderCard[] = [];
  const failures: string[] = [];
  for (const r of results) {
    if (r.success && r.cards?.length) cards.push(...r.cards);
    else if (r.error) failures.push(r.error);
  }

  if (cards.length === 0) {
    return failures.length > 0
      ? { success: false, error: failures.join("\n\n") }
      : { success: true, cards: [] };
  }

  // Surface any partial failures as a trailing note on the last card.
  if (failures.length > 0) {
    const last = cards[cards.length - 1];
    last.footer = [
      ...(last.footer ?? []),
      "",
      `\u26a0\ufe0f Some accounts failed: ${failures.join("; ")}`,
    ];
  }

  return { success: true, cards };
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

    const monthlyGrant = balance.next_monthly_grant_amount ?? 0;

    const usd = balance.total_balance_usd ? ` ($${balance.total_balance_usd} USD)` : "";
    const header: string[] = [`Balance:        ${balance.current_point_balance ?? "?"} pts${usd}`];

    const daily = formatPoeTimestamp(balance.next_daily_grant_time);
    if (daily) header.push(`Daily grant:    +${balance.next_daily_grant_amount ?? "?"} (Resets in: ${daily})`);

    const windows: QuotaWindow[] = [];
    if (monthlyGrant > 0) {
      const currentPts = balance.current_point_balance ?? 0;
      const remainPct = Math.round((currentPts / monthlyGrant) * 100);
      const monthly = formatPoeTimestamp(balance.next_monthly_grant_time);
      windows.push({
        label: "Monthly",
        remaining: remainPct,
        detail: [`Points: ${currentPts} / ${monthlyGrant}`],
        resetText: monthly ?? undefined,
      });
    }

    const footer: string[] = [];
    if (typeof balance.addon_point_balance === "number" && balance.addon_point_balance > 0)
      footer.push(`Add-on points:  ${balance.addon_point_balance}`);

    return {
      success: true,
      cards: [{ header, windows, footer: footer.length ? footer : undefined }],
    };
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

// Robustly convert Z.AI's nextResetTime (epoch s or ms; may be missing/NaN) to
// an ISO string. Returns undefined instead of throwing on bad input — this is
// the fix for the long-standing "Invalid Date" failure that killed the card.
function zaiResetAt(raw: number | null | undefined): string | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  const ms = raw < 1e12 ? raw * 1000 : raw; // seconds vs milliseconds heuristic
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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

    const header: string[] = [`Plan:           ${planLabel}`];
    if (priceLine) header.push(priceLine);
    if (validityLine) header.push(validityLine);
    if (renewalLine) header.push(renewalLine);

    const limits = [...quota.data.limits].sort((a, b) => {
      const weight = (u: number) => (u === 3 ? 1 : u === 6 ? 2 : u === 5 ? 3 : 99);
      return weight(a.unit) - weight(b.unit);
    });

    const windows: QuotaWindow[] = [];
    for (const limit of limits) {
      const remain = Math.round(100 - Math.max(0, Math.min(100, limit.percentage)));

      const detail: string[] = [];
      if (
        limit.type === "TIME_LIMIT" &&
        typeof limit.remaining === "number" &&
        typeof limit.usage === "number"
      ) {
        detail.push(`Used: ${limit.usage} / ${limit.remaining + limit.usage}`);
      }

      const extra: string[] = [];
      if (limit.usageDetails?.length) {
        const withUsage = limit.usageDetails.filter((d) => d.usage > 0);
        if (withUsage.length) {
          extra.push("  " + withUsage.map((d) => `${d.modelCode}: ${d.usage}`).join(", "));
        }
      }

      windows.push({
        label: zaiUnitLabel(limit.unit, limit.number),
        remaining: remain,
        resetAt: zaiResetAt(limit.nextResetTime),
        detail,
        extra,
      });
    }

    return { success: true, cards: [{ header, windows }] };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// xAI/Grok
//
// Two separate auth stores feed this card; both are xAI OAuth tokens for the
// same account but are minted with different `referrer` claims and live in
// different files (by design — separate login UIs):
//
//   • Dev token  (~/.local/share/opencode/auth.json → "xai"/"xai-oauth",
//                  referrer "opencode"): used for the dev API models check.
//   • Consumer   (~/.grok/auth.json → "<issuer>::<client>".key,
//                  referrer "grok-build"): the token the Grok Build TUI and
//                  grok.com use. Carries refresh_token + expires_at.
//
// Both tokens can read the cli-chat-proxy billing endpoint, which has two views:
//   GET /v1/billing                  → {monthlyLimit, used} (15k included tokens)
//   GET /v1/billing?format=credits   → {creditUsagePercent, billingPeriodEnd}
//                                       — the "Credits used: X% · Resets …" the
//                                       TUI/website show.
//
// We prefer the consumer token (refreshing it if expired) and fall back to the
// dev token so the card still renders for dev-only users.
// ============================================================

const GROK_BILLING_BASE = "https://cli-chat-proxy.grok.com/v1/billing";
const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_OAUTH_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";

interface GrokConsumerAuth {
  storeKey: string; // the "<issuer>::<client>" key in the file
  key: string; // access token (JWT)
  refreshToken?: string;
  expiresAt?: number; // epoch ms
}

function grokConsumerAuthPath(): string {
  return join(homedir(), ".grok", "auth.json");
}

// Parse ~/.grok/auth.json. Returns null when the file is missing/malformed so
// callers can degrade gracefully (the file is written by `grok login`).
function loadGrokConsumerAuth(): GrokConsumerAuth | null {
  try {
    const p = grokConsumerAuthPath();
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    for (const [storeKey, v] of Object.entries(data)) {
      if (v && typeof v === "object" && typeof (v as any).key === "string") {
        const entry = v as any;
        const expMs = entry.expires_at ? Date.parse(entry.expires_at) : NaN;
        return {
          storeKey,
          key: entry.key,
          refreshToken: typeof entry.refresh_token === "string" ? entry.refresh_token : undefined,
          expiresAt: Number.isFinite(expMs) ? expMs : undefined,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Refresh an expired consumer token using its refresh_token and persist the new
// access/refresh/expiry back into ~/.grok/auth.json. Returns the fresh access
// token, or null on failure (caller falls back to the dev token).
async function refreshGrokConsumerToken(auth: GrokConsumerAuth): Promise<string | null> {
  if (!auth.refreshToken) return null;
  try {
    const res = await fetchTimeout(
      XAI_OAUTH_TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: XAI_OAUTH_CLIENT_ID,
          refresh_token: auth.refreshToken,
        }),
      },
      10_000,
      1,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;

    // Best-effort write-back so the next run starts fresh. Never throw.
    try {
      const p = grokConsumerAuthPath();
      const file = JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
      const entry = file[auth.storeKey];
      if (entry && typeof entry === "object") {
        entry.key = data.access_token;
        if (data.refresh_token) entry.refresh_token = data.refresh_token;
        if (typeof data.expires_in === "number") {
          entry.expires_at = new Date(Date.now() + data.expires_in * 1000).toISOString();
        }
        writeFileSync(p, JSON.stringify(file, null, 2));
      }
    } catch {}

    return data.access_token;
  } catch {
    return null;
  }
}

// Resolve a usable consumer access token: use the stored one if still valid,
// otherwise try to refresh. Returns null if there's no consumer auth at all.
async function resolveGrokConsumerToken(): Promise<string | null> {
  const auth = loadGrokConsumerAuth();
  if (!auth) return null;
  const expired = typeof auth.expiresAt === "number" && auth.expiresAt <= Date.now() + 60_000;
  if (expired) {
    const refreshed = await refreshGrokConsumerToken(auth);
    return refreshed ?? auth.key; // try the stale token as a last resort
  }
  return auth.key;
}

// Format an ISO billing-period end as a compact "Mon D" reset hint (e.g.
// "Jul 1"), matching the Grok Build TUI / grok.com "Resets: …" line.
function formatGrokResetDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface GrokCreditsConfig {
  creditUsagePercent?: number;
  billingPeriodEnd?: string;
  onDemandUsed?: { val?: number };
  onDemandCap?: { val?: number };
}

interface GrokIncludedConfig {
  monthlyLimit?: { val?: number };
  used?: { val?: number };
  billingPeriodEnd?: string;
}

async function queryXai(auth: XaiAuthData | undefined): Promise<QueryResult | null> {
  if (!auth || auth.type !== "oauth" || !auth.access) return null;
  if (auth.expires && auth.expires < Date.now())
    return { success: false, error: "\u26a0\ufe0f xAI token expired. Use a Grok model in OpenCode to refresh." };

  const header: string[] = ["Auth:           valid"];
  if (typeof auth.expires === "number" && auth.expires > Date.now()) {
    header.push(`Token expires:  ${formatDuration(Math.floor((auth.expires - Date.now()) / 1000))}`);
  }

  // Prefer the consumer (grok-build) token for the credits view — it's what the
  // Grok Build TUI and grok.com show. Fall back to the dev token, which reads
  // the same account's billing.
  const consumerToken = await resolveGrokConsumerToken();
  const hasConsumer = !!consumerToken;
  const creditsToken = consumerToken ?? auth.access;

  const windows: QuotaWindow[] = [];

  // SuperGrok free credits — GET /v1/billing?format=credits
  try {
    const r = await fetchTimeout(`${GROK_BILLING_BASE}?format=credits`, {
      headers: { Authorization: `Bearer ${creditsToken}`, Accept: "application/json" },
    });
    if (r.ok) {
      const cfg = ((await r.json()) as { config?: GrokCreditsConfig }).config ?? {};
      const usedPct = Number(cfg.creditUsagePercent ?? 0);
      const remain = Math.max(0, Math.min(100, 100 - usedPct));
      const resetDate = formatGrokResetDate(cfg.billingPeriodEnd);
      const detail = [
        `Credits used: ${usedPct.toFixed(2)}%${resetDate ? ` \u00b7 Resets ${resetDate}` : ""}`,
      ];
      const onDemand = cfg.onDemandUsed?.val ?? 0;
      const onDemandCap = cfg.onDemandCap?.val ?? 0;
      if (onDemandCap > 0) detail.push(`On-demand: ${onDemand}/${onDemandCap}`);
      windows.push({
        label: hasConsumer ? "SuperGrok free credits" : "Grok free credits",
        remaining: remain,
        resetAt: cfg.billingPeriodEnd,
        detail,
      });
    }
  } catch {
    // non-fatal — keep rendering the rest of the card
  }

  // Dev / included API credits — GET /v1/billing (15k included tokens view)
  try {
    const billRes = await fetchTimeout(GROK_BILLING_BASE, {
      headers: { Authorization: `Bearer ${auth.access}`, Accept: "application/json" },
    });
    if (billRes.ok) {
      const cfg = ((await billRes.json()) as { config?: GrokIncludedConfig }).config ?? {};
      const limit = cfg.monthlyLimit?.val;
      const used = cfg.used?.val;
      if (typeof limit === "number" && limit > 0 && typeof used === "number") {
        const remain = Math.max(0, Math.min(100, (1 - used / limit) * 100));
        windows.push({
          label: "Dev API (included tokens)",
          remaining: remain,
          resetAt: cfg.billingPeriodEnd,
          detail: [`Used: ${used.toLocaleString()} / ${limit.toLocaleString()} tokens`],
        });
      }
    }
  } catch {}

  if (!hasConsumer) {
    header.push("SuperGrok:      run `grok login` to show free credits");
  }

  // Validate the dev token still works against the API.
  try {
    const res = await fetchTimeout("https://api.x.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${auth.access}`,
        Accept: "application/json",
        "x-grok-source": "opencode-allstatus",
      },
    });
    if (!res.ok) throw new Error(`xAI API error (${res.status})`);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { success: true, cards: [{ header, windows: windows.length ? windows : undefined }] };
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

function minimaxWindow(
  bucketName: string,
  kind: "interval" | "weekly",
  pct: number | undefined,
  used: number | undefined,
  total: number | undefined,
  resetRaw: number | undefined,
  status: number | undefined,
): QuotaWindow {
  const remain = Math.max(0, Math.min(100, Math.round(pct ?? 100)));
  const throttled = status !== undefined && status !== 1;
  const detail: string[] = [];
  if (typeof total === "number" && total > 0 && typeof used === "number") {
    detail.push(`Used: ${used} / ${total}`);
  }
  const resetSec = minimaxResetSeconds(resetRaw);
  return {
    label: minimaxWindowLabel(bucketName, kind),
    remaining: remain,
    warn: throttled ? `\u26a0\ufe0f throttled (status=${status})` : undefined,
    detail,
    resetInSec: resetSec !== undefined && resetSec > 0 ? resetSec : undefined,
  };
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
        cards: [{ header: ["Plan:           Token Plan (no active buckets returned)"] }],
      };
    }

    const multi = buckets.length > 1;
    const cards: ProviderCard[] = [];
    for (const b of buckets) {
      const name = b.model_name!;
      cards.push({
        subtitle: multi ? name : undefined,
        windows: [
          minimaxWindow(
            name,
            "interval",
            b.current_interval_remaining_percent,
            b.current_interval_usage_count,
            b.current_interval_total_count,
            b.remains_time,
            b.current_interval_status,
          ),
          minimaxWindow(
            name,
            "weekly",
            b.current_weekly_remaining_percent,
            b.current_weekly_usage_count,
            b.current_weekly_total_count,
            b.weekly_remains_time,
            b.current_weekly_status,
          ),
        ],
      });
    }

    return { success: true, cards };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// StepFun Token Plan (stepfun.ai — Oasis dashboard API)
// ============================================================
//
//   Quota source:    POST https://platform.stepfun.ai/api/.../QueryStepPlanRateLimit
//   Plan source:     POST https://platform.stepfun.ai/api/.../GetStepPlanStatus
//   Auth:            Oasis browser session cookies (Oasis-Token, Oasis-Webid,
//                    __Secure-next-auth.session-token) stored in
//                    ~/.config/opencode/stepfun-cookies.json
//   Response shape:  five_hour_usage_left_rate (0-1) + weekly_usage_left_rate (0-1)
//                    with epoch-second reset times.
//
//   To set up: log into platform.stepfun.ai, open DevTools → Application →
//   Cookies, copy the cookie values, and save as:
//     {
//       "oasisToken": "<Oasis-Token value>",
//       "oasisWebid": "<Oasis-Webid value>"
//     }
//   Note: sessionToken is optional; only oasisToken and oasisWebid are required.
//   To include it:
//     {
//       "oasisToken": "<Oasis-Token value>",
//       "oasisWebid": "<Oasis-Webid value>",
//       "sessionToken": "<__Secure-next-auth.session-token value>"
//     }

const STEPFUN_DASHBOARD_BASE = "https://platform.stepfun.ai";
const STEPFUN_OASIS_APPID = "20700";

interface StepFunCookieConfig {
  oasisToken: string;
  oasisWebid: string;
  sessionToken?: string;
}

interface StepFunPlanStatusResponse {
  status: number;
  desc: string;
  subscription: {
    plan_type: number;
    name: string;
    status: number;
    pay_channel: number;
    activated_at: string;
    expired_at: string;
    auto_renew: boolean;
    plan_id: string;
    source_channel_code: string;
  };
  plan_definition: {
    type: number;
    price: string;
    duration_days: number;
    support_models: string[];
    available: boolean;
    original_price: string;
    plan_id: string;
    billing_cycle: number;
  };
  can_resign: boolean;
}

interface StepFunRateLimitResponse {
  status: number;
  desc: string;
  five_hour_usage_left_rate: number;
  five_hour_usage_reset_time: string;
  weekly_usage_left_rate: number;
  weekly_usage_reset_time: string;
}

function stepfunCookiesPath(): string {
  return join(opencodeConfigDir(), "stepfun-cookies.json");
}

function loadStepFunCookies(): StepFunCookieConfig | null {
  try {
    const p = stepfunCookiesPath();
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf-8");
    const cfg = JSON.parse(raw) as StepFunCookieConfig;
    if (cfg.oasisToken && cfg.oasisWebid) return cfg;
    return null;
  } catch {
    return null;
  }
}

function stepfunDashboardHeaders(cookies: StepFunCookieConfig): Record<string, string> {
  const cookieParts = [
    `Oasis-Token=${cookies.oasisToken}`,
    `Oasis-Webid=${cookies.oasisWebid}`,
  ];
  if (cookies.sessionToken) {
    cookieParts.push(`__Secure-next-auth.session-token=${cookies.sessionToken}`);
  }
  return {
    "Content-Type": "application/json",
    "oasis-appid": STEPFUN_OASIS_APPID,
    "oasis-platform": "web",
    "oasis-webid": cookies.oasisWebid,
    Cookie: cookieParts.join("; "),
    Origin: STEPFUN_DASHBOARD_BASE,
    Referer: `${STEPFUN_DASHBOARD_BASE}/plan-usage`,
    "User-Agent": "OpenCode-AllStatus/1.0",
    Accept: "application/json",
  };
}

function stepfunResetAt(epochSec: string | undefined): string | undefined {
  if (!epochSec) return undefined;
  const s = Number(epochSec);
  if (!Number.isFinite(s) || s <= 0) return undefined;
  const d = new Date(s * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function queryStepFun(ansi = false): Promise<QueryResult | null> {
  const cookies = loadStepFunCookies();
  if (!cookies) return null;

  const headers = stepfunDashboardHeaders(cookies);

  try {
    const [rateRes, planRes] = await Promise.all([
      fetchTimeout(
        `${STEPFUN_DASHBOARD_BASE}/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`,
        { method: "POST", headers, body: "{}" },
      ),
      fetchTimeout(
        `${STEPFUN_DASHBOARD_BASE}/api/step.openapi.devcenter.Dashboard/GetStepPlanStatus`,
        { method: "POST", headers, body: "{}" },
      ),
    ]);

    // Parse rate limit data
    let rateLimit: StepFunRateLimitResponse | null = null;
    if (rateRes.ok) {
      try {
        const data = (await rateRes.json()) as StepFunRateLimitResponse;
        if (data.status === 1) rateLimit = data;
      } catch { /* keep null */ }
    }

    // Parse plan status data
    let planStatus: StepFunPlanStatusResponse | null = null;
    if (planRes.ok) {
      try {
        const data = (await planRes.json()) as StepFunPlanStatusResponse;
        if (data.status === 1) planStatus = data;
      } catch { /* keep null */ }
    }

    if (!rateLimit && !planStatus) {
      if (!rateRes.ok && !planRes.ok) {
        const body = await rateRes.text().catch(() => "");
        throw new Error(`StepFun dashboard API error (${rateRes.status}): ${body.slice(0, 200)}`);
      }
      return {
        success: true,
        cards: [{ header: ["Plan:           StepFun (no data returned)"] }],
      };
    }

    const header: string[] = [];
    const plan = planStatus?.subscription;
    const def = planStatus?.plan_definition;

    if (plan) {
      header.push(`Plan:           ${plan.name}`);
      if (plan.auto_renew) {
        const exp = plan.expired_at ? stepfunResetAt(plan.expired_at) : undefined;
        if (exp) header.push(`Renews:          ${formatResetAt(exp)}`);
      } else {
        const exp = plan.expired_at ? stepfunResetAt(plan.expired_at) : undefined;
        if (exp) header.push(`Expires:         ${formatResetAt(exp)}`);
      }
      if (def?.price) {
        const priceNum = Number(def.price) / 100;
        if (Number.isFinite(priceNum)) {
          header.push(`Price:           $${priceNum.toFixed(2)}/mo`);
        }
      }
    }

    const windows: QuotaWindow[] = [];
    if (rateLimit) {
      const fiveHourRemain = Math.round(rateLimit.five_hour_usage_left_rate * 100);
      windows.push({
        label: "5-hour rolling",
        remaining: fiveHourRemain,
        resetAt: stepfunResetAt(rateLimit.five_hour_usage_reset_time),
      });

      const weeklyRemain = Math.round(rateLimit.weekly_usage_left_rate * 100);
      windows.push({
        label: "Weekly",
        remaining: weeklyRemain,
        resetAt: stepfunResetAt(rateLimit.weekly_usage_reset_time),
      });
    }

    const footer: string[] = [];
    if (def?.support_models?.length) {
      footer.push(`Models:         ${def.support_models.join(", ")}`);
    }

    return {
      success: true,
      cards: [{ header, windows, footer: footer.length ? footer : undefined }],
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// QwenCloud Token Plan (home.qwencloud.com — Aliyun BSS API)
// ============================================================
//
//   Quota source:    POST https://home.qwencloud.com/data/api.json?...GetSeatSubscriptionSummary
//   Renewal source:  POST https://home.qwencloud.com/data/api.json?...CheckTokenPlanAutoRenewal
//   Auth:            Browser session cookies (login_qwencloud_ticket,
//                    login_aliyunid_pk, isg, login_ESM_account_ticket)
//                    stored in ~/.config/opencode/qwencloud-cookies.json
//   CSRF:            Requires sec_token extracted from homepage HTML
//   Response shape:  TotalValue + SurplusValue (credits), EndTime, RemainingDays
//
//   To set up: log into home.qwencloud.com, open DevTools → Application →
//   Cookies, copy the cookie values, and save as:
//     {
//       "ticket": "<login_qwencloud_ticket>",
//       "aliyunPk": "<login_aliyunid_pk>",
//       "isg": "<isg>",
//       "esmTicket": "<login_ESM_account_ticket>"
//     }

const QWENCLOUD_BASE = "https://home.qwencloud.com";
const QWENCLOUD_BX_V = "2.5.36";

interface QwenCloudCookieConfig {
  ticket: string;
  aliyunPk: string;
  isg: string;
  esmTicket?: string;
}

interface QwenCloudSubSummaryResponse {
  code: string;
  data: {
    Data: {
      EndTime: number;
      StartTime: number;
      RemainingDays: string;
      SubscriptionGroupList: Array<{
        SpecType: string;
        SubscriptionTotalNumber: number;
        EquityList: Array<{
          EquityCode: string;
          TotalValue: string;
          SurplusValue: string;
          EquityType: string;
        }>;
        NextCycleFlushTime: number;
      }>;
    };
    Code: string;
    Success: boolean;
  };
}

interface QwenCloudRenewalResponse {
  Code: string;
  Success: boolean;
  Data: {
    AutoRenewal: number;
  };
}

function qwencloudCookiesPath(): string {
  return join(opencodeConfigDir(), "qwencloud-cookies.json");
}

function loadQwenCloudCookies(): QwenCloudCookieConfig | null {
  try {
    const p = qwencloudCookiesPath();
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf-8");
    const cfg = JSON.parse(raw) as QwenCloudCookieConfig;
    if (cfg.ticket && cfg.aliyunPk && cfg.isg) return cfg;
    return null;
  } catch {
    return null;
  }
}

function qwencloudCookieString(cookies: QwenCloudCookieConfig): string {
  let c = `login_qwencloud_ticket=${cookies.ticket}; login_aliyunid_pk=${cookies.aliyunPk}; isg=${cookies.isg}`;
  if (cookies.esmTicket) c += `; login_ESM_account_ticket=${cookies.esmTicket}`;
  return c;
}

function qwencloudHeaders(cookies: QwenCloudCookieConfig): Record<string, string> {
  return {
    Cookie: qwencloudCookieString(cookies),
    "bx-v": QWENCLOUD_BX_V,
    Referer: `${QWENCLOUD_BASE}/`,
    Origin: QWENCLOUD_BASE,
    "User-Agent": "OpenCode-AllStatus/1.0",
    Accept: "application/json, text/plain, */*",
  };
}

// Fetch the homepage, extract SEC_TOKEN from inline JS.
async function qwencloudFetchSecToken(
  cookies: QwenCloudCookieConfig,
): Promise<string | null> {
  try {
    const headers = qwencloudHeaders(cookies);
    delete (headers as Record<string, string | undefined>)["Content-Type"];
    const res = await fetchTimeout(`${QWENCLOUD_BASE}/`, {
      headers,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/SEC_TOKEN:\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function queryQwenCloud(ansi = false): Promise<QueryResult | null> {
  const cookies = loadQwenCloudCookies();
  if (!cookies) return null;

  // Step 1: get CSRF token from homepage
  const secToken = await qwencloudFetchSecToken(cookies);
  if (!secToken) {
    return {
      success: false,
      error:
        "Could not extract SEC_TOKEN from QwenCloud homepage.\n" +
        "Your session cookies may have expired — re-copy them from the browser.",
    };
  }

  const baseHeaders = qwencloudHeaders(cookies);

  try {
    // Step 2: call subscription + renewal in parallel
    const params = new URLSearchParams({
      product: "BssOpenAPI-V3",
      action: "GetSeatSubscriptionSummary",
      sec_token: secToken,
      region: "ap-southeast-1",
      params: JSON.stringify({ productCode: "sfm_tokenplanteams_dp_intl" }),
    });

    const [subRes, renewalRes] = await Promise.all([
      fetchTimeout(
        `${QWENCLOUD_BASE}/data/api.json?product=BssOpenAPI-V3&action=GetSeatSubscriptionSummary`,
        {
          method: "POST",
          headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        },
      ),
      fetchTimeout(
        `${QWENCLOUD_BASE}/data/api.json?product=BssOpenApi&action=CheckTokenPlanAutoRenewal`,
        {
          method: "POST",
          headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            CommodityCode: "sfm_tokenplanteams_dp_intl",
          }),
        },
      ),
    ]);

    // Parse subscription summary
    let subData: QwenCloudSubSummaryResponse | null = null;
    if (subRes.ok) {
      try {
        subData = (await subRes.json()) as QwenCloudSubSummaryResponse;
      } catch { /* keep null */ }
    }

    // Parse auto-renewal
    let autoRenewal: boolean | null = null;
    if (renewalRes.ok) {
      try {
        const data = (await renewalRes.json()) as QwenCloudRenewalResponse;
        if (data.Success) autoRenewal = data.Data.AutoRenewal === 1;
      } catch { /* keep null */ }
    }

    if (!subData || subData.code !== "200" || !subData.data?.Data) {
      if (!subRes.ok) {
        const body = await subRes.text().catch(() => "");
        throw new Error(`QwenCloud API error (${subRes.status}): ${body.slice(0, 200)}`);
      }
      return {
        success: true,
        cards: [{ header: ["Plan:           QwenCloud (no subscription data)"] }],
      };
    }

    const detail = subData.data.Data;
    const group = detail.SubscriptionGroupList?.[0];
    const equity = group?.EquityList?.find((e) => e.EquityType === "CREDITS");

    // Plan info
    const seats = group?.SubscriptionTotalNumber ?? 1;
    const spec = group?.SpecType ?? "standard";
    const header: string[] = [
      `Plan:           Token Plan Team Edition (${spec}, ${seats} seat${seats > 1 ? "s" : ""})`,
    ];

    // Auto-renewal
    if (autoRenewal !== null) {
      header.push(`Auto-renewal:   ${autoRenewal ? "enabled" : "disabled"}`);
    }

    const windows: QuotaWindow[] = [];
    if (equity) {
      const total = Number(equity.TotalValue);
      const surplus = Number(equity.SurplusValue);
      const used = total - surplus;
      const remainPct = total > 0 ? Math.round((surplus / total) * 100) : 100;

      windows.push({
        label: `Credits (${detail.RemainingDays ?? "?"}d remaining)`,
        remaining: remainPct,
        detail: [`Used: ${used.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
        resetAt: group?.NextCycleFlushTime
          ? new Date(group.NextCycleFlushTime).toISOString()
          : undefined,
      });
    }

    const footer: string[] = [];
    if (detail.EndTime) {
      footer.push(
        `Cycle:          ${new Date(detail.StartTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${new Date(detail.EndTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      );
    }

    return {
      success: true,
      cards: [{ header, windows, footer: footer.length ? footer : undefined }],
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Mistral Vibe Usage (console.mistral.ai — tRPC endpoint)
// ============================================================
//
//   Quota source:    POST https://console.mistral.ai/api-ui/trpc/... (batch tRPC)
//   Auth:            Browser session cookies stored in
//                    ~/.config/opencode/mistral-cookies.json
//   CSRF:            Extracted from cookie string via regex /csrftoken=([^;]+)/
//   Response:        newline-delimited JSON lines with usage_percentage,
//                    reset_at, and email fields.
//
//   To set up: log into console.mistral.ai, open DevTools → Application →
//   Cookies, copy the cookie string (or the full cookie header value), and
//   save as:
//     { "cookie": "<full cookie string>" }

const MISTRAL_TRPC_URL =
  "https://console.mistral.ai/api-ui/trpc/user.me,vibe.getApiKey,billing.vibeUsage?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%2C%221%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%2C%222%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%7D";

function mistralCookiesPath(): string {
  return join(opencodeConfigDir(), "mistral-cookies.json");
}

function loadMistralCookies(): { cookie: string } | null {
  try {
    const p = mistralCookiesPath();
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cookie = typeof parsed.cookie === "string" ? parsed.cookie : null;
    if (!cookie) return null;
    return { cookie };
  } catch {
    return null;
  }
}

function extractCsrfToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/csrftoken=([^;]+)/);
  return match ? match[1] : null;
}

async function queryMistral(_a: AuthData | undefined, ansi = false): Promise<QueryResult | null> {
  const cookies = loadMistralCookies();
  if (!cookies) return null;

  const csrfToken = extractCsrfToken(cookies.cookie);
  if (!csrfToken) {
    return {
      success: false,
      error:
        "Could not extract csrftoken from mistral-cookies.json cookie string.\n" +
        "Ensure the cookie value contains a csrftoken field.",
    };
  }

  const headers: Record<string, string> = {
    Cookie: cookies.cookie,
    "x-csrftoken": csrfToken,
    "trpc-accept": "application/jsonl",
    "User-Agent": "OpenCode-AllStatus/1.0",
  };

  try {
    const res = await fetchTimeout(MISTRAL_TRPC_URL, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Mistral API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const text = await res.text();

    // Parse using regex against the entire response body (tRPC uses array-based JSONL format)
    let usagePercentage: number | null = null;
    let resetAt: string | null = null;
    let email: string | null = null;

    // Extract values directly from raw response text using regex
    const pctMatch = text.match(/"usage_percentage"\s*:\s*(\d+(?:\.\d+)?)/);
    if (pctMatch) usagePercentage = parseFloat(pctMatch[1]);

    const resetMatch = text.match(/"reset_at"\s*:\s*"([^"]+)"/);
    if (resetMatch) resetAt = resetMatch[1];

    const emailMatch = text.match(/"email"\s*:\s*"([^"]+)"/);
    if (emailMatch) email = emailMatch[1];

    if (usagePercentage === null) {
      return {
        success: false,
        error: "Mistral Vibe: Failed to parse usage_percentage from response.",
      };
    }

    const remainPct = usagePercentage !== null ? Math.round(100 - usagePercentage) : null;

    const header: string[] = [`Account:        ${email ?? "unknown"}`];
    const windows: QuotaWindow[] = [];
    if (remainPct !== null) {
      windows.push({
        label: "Vibe Usage",
        remaining: remainPct,
        resetAt: resetAt ?? undefined,
      });
    }

    return {
      success: true,
      cards: [{ header, windows: windows.length ? windows : undefined }],
    };
  } catch (err) {
    return {
      success: false,
      error: `Mistral Vibe: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================
// BytePlus Ark Coding Plan (console.byteplus.com)
// ============================================================
//
//   Quota source:    POST https://console.byteplus.com/api/top/ark/ap-southeast-1/2024-01-01/GetCodingPlanUsage
//   Auth:            Browser session cookies stored in
//                    ~/.config/opencode/byteplus-cookies.json
//   CSRF:            Extracted from cookie string via regex /csrfToken=([^;]+)/
//   Response:        JSON with QuotaUsage array containing session/weekly/monthly levels
//
//   To set up: log into console.byteplus.com, open DevTools → Application →
//   Cookies, copy the cookie string (or the full cookie header value), and
//   save as:
//     { "cookie": "<full cookie string>" }

const BYTEPLUS_API_URL =
  "https://console.byteplus.com/api/top/ark/ap-southeast-1/2024-01-01/GetCodingPlanUsage";

function byteplusCookiesPath(): string {
  return join(opencodeConfigDir(), "byteplus-cookies.json");
}

function loadBytePlusCookies(): { cookie: string } | null {
  try {
    const p = byteplusCookiesPath();
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cookie = typeof parsed.cookie === "string" ? parsed.cookie : null;
    if (!cookie) return null;
    return { cookie };
  } catch {
    return null;
  }
}

function extractBytePlusCsrfToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/csrfToken=([^;]+)/);
  return match ? match[1] : null;
}

interface BytePlusUsageResult {
  ResponseMetadata: {
    RequestId: string;
    Action: string;
  };
  Result: {
    Status: string;
    UpdateTimestamp: number;
    QuotaUsage: Array<{
      Level: string;
      Percent: number;
      ResetTimestamp: number;
    }>;
  };
}

async function queryBytePlus(_a: AuthData | undefined, ansi = false): Promise<QueryResult | null> {
  const cookies = loadBytePlusCookies();
  if (!cookies) return null;

  const csrfToken = extractBytePlusCsrfToken(cookies.cookie);
  if (!csrfToken) {
    return {
      success: false,
      error:
        "Could not extract csrfToken from byteplus-cookies.json cookie string.\n" +
        "Ensure the cookie value contains a csrfToken field.",
    };
  }

  const headers: Record<string, string> = {
    Cookie: cookies.cookie,
    "X-Csrf-Token": csrfToken,
    "Content-Type": "application/json",
    "User-Agent": "OpenCode-AllStatus/1.0",
  };

  try {
    const res = await fetchTimeout(BYTEPLUS_API_URL, {
      method: "POST",
      headers,
      body: "{}",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`BytePlus API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as BytePlusUsageResult;

    // Check for application-level errors in the response envelope
    const error = (data.ResponseMetadata as any)?.Error;
    if (error) {
      throw new Error(`BytePlus API error: ${error.Code ?? error.Message ?? JSON.stringify(error)}`);
    }

    const result = data.Result;
    if (!result?.QuotaUsage || !Array.isArray(result.QuotaUsage) || result.QuotaUsage.length === 0) {
      return {
        success: true,
        cards: [{ header: ["Plan:           BytePlus Ark Coding Plan (no data returned)"] }],
      };
    }

    // Check Result.Status for non-success states
    if (result.Status && !/running|success|active/i.test(result.Status)) {
      throw new Error(`BytePlus API non-success status: ${result.Status}`);
    }

    const header: string[] = [`Plan:           BytePlus Ark Coding Plan`];
    if (result.Status) {
      header.push(`Status:          ${result.Status}`);
    }

    // Sort order: session first, then weekly, then monthly
    const sortOrder: Record<string, number> = { session: 0, weekly: 1, monthly: 2 };
    const sortedUsage = [...result.QuotaUsage].sort(
      (a, b) => (sortOrder[a.Level.toLowerCase()] ?? 999) - (sortOrder[b.Level.toLowerCase()] ?? 999),
    );

    const windows: QuotaWindow[] = [];
    for (const usage of sortedUsage) {
      const level = usage.Level;
      const percent = usage.Percent;
      const resetTs = usage.ResetTimestamp;

      if (typeof level !== "string" || typeof percent !== "number" || typeof resetTs !== "number") {
        continue; // skip malformed entries
      }

      const label = level.charAt(0).toUpperCase() + level.slice(1);
      const remaining = Math.round(100 - percent);
      const resetDate = new Date(resetTs * 1000);
      const resetAt = Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined;

      windows.push({ label, remaining, resetAt });
    }

    return {
      success: true,
      cards: [{ header, windows: windows.length ? windows : undefined }],
    };
  } catch (err) {
    return {
      success: false,
      error: `BytePlus: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================
// NanoGPT (nano-gpt.com)
// ============================================================
//
//   Balance:       POST /api/check-balance          → usd_balance, nano_balance
//   Subscription:  GET  /api/subscription/v1/usage  → metered allowances
//   Auth:          x-api-key: sk-nano-…
//   Subscription windows expose used/remaining/percentUsed (fraction) and a
//   per-window resetAt (epoch ms); pay-as-you-go accounts only show balance.

const NANOGPT_BASE_URL = "https://nano-gpt.com";
const NANOGPT_MULTI_AUTH_DUMMY_KEY = "opencode-nanogpt-multi-key";

interface NanoGptBalance {
  usd_balance?: string;
  nano_balance?: string;
}

interface NanoGptSubWindow {
  used?: number;
  remaining?: number;
  percentUsed?: number; // fraction 0-1
  resetAt?: number; // epoch ms
}

interface NanoGptSubscription {
  active?: boolean;
  provider?: string;
  cancelAtPeriodEnd?: boolean;
  limits?: {
    weeklyInputTokens?: number | null;
    dailyInputTokens?: number | null;
    dailyImages?: number | null;
  };
  period?: { currentPeriodEnd?: string };
  weeklyInputTokens?: NanoGptSubWindow | null;
  dailyInputTokens?: NanoGptSubWindow | null;
  dailyImages?: NanoGptSubWindow | null;
}

function nanoGptResetAt(ms: number | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return undefined;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function isRealNanoGptKey(key: string | undefined): key is string {
  return typeof key === "string" && key.trim() !== "" && key.trim() !== NANOGPT_MULTI_AUTH_DUMMY_KEY;
}

function loadNanoGptMultiAuthCredentials(): NanoGptCredential[] {
  try {
    const raw = readFileSync(nanoGptMultiAuthKeysPath(), "utf-8");
    const data = JSON.parse(raw) as NanoGptStoredKeysFile;
    const credentials: NanoGptCredential[] = [];

    for (const stored of data.keys ?? []) {
      if (stored.enabled === false || !isRealNanoGptKey(stored.key)) continue;
      credentials.push({
        source: "multi-auth",
        label: stored.label ?? stored.id,
        key: stored.key.trim(),
        cooldownUntil: stored.cooldownUntil,
      });
    }

    return credentials;
  } catch {
    return [];
  }
}

function resolveNanoGptCredentials(auth: NanoGptAuthData | undefined): NanoGptCredential[] {
  const credentials: NanoGptCredential[] = [];
  const seen = new Set<string>();
  const add = (credential: NanoGptCredential): void => {
    const key = credential.key.trim();
    if (!isRealNanoGptKey(key) || seen.has(key)) return;
    seen.add(key);
    credentials.push({ ...credential, key });
  };

  // Prefer multi-auth metadata for duplicate keys; it has user labels and pool state.
  for (const credential of loadNanoGptMultiAuthCredentials()) add(credential);
  if (isRealNanoGptKey(auth?.key)) add({ source: "native", label: "Native auth", key: auth.key });

  return credentials;
}

function nanoGptSubtitle(credential: NanoGptCredential, multi: boolean): string | undefined {
  if (!multi) return undefined;
  return credential.label?.trim() || (credential.source === "native" ? "Native auth" : "Multi-auth key");
}

function nanoGptAuthSource(credential: NanoGptCredential): string {
  return credential.source === "multi-auth" ? "NanoGPT multi-auth" : "OpenCode native auth";
}

function humanCount(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const trim = (v: number, dp: number) => v.toFixed(dp).replace(/\.0$/, "");
  if (abs >= 1e9) return trim(n / 1e9, abs >= 1e10 ? 0 : 1) + "B";
  if (abs >= 1e6) return trim(n / 1e6, abs >= 1e7 ? 0 : 1) + "M";
  if (abs >= 1e3) return trim(n / 1e3, abs >= 1e4 ? 0 : 1) + "K";
  return String(n);
}

function nanoGptWindow(
  label: string,
  w: NanoGptSubWindow | null | undefined,
  limit: number | null | undefined,
  unit: "tokens" | "images",
): QuotaWindow | null {
  if (!w) return null;
  const used = w.used ?? 0;
  const remaining = w.remaining ?? 0;
  const total = typeof limit === "number" && limit > 0 ? limit : used + remaining;

  let remainPct: number;
  if (total > 0) remainPct = Math.round((remaining / total) * 100);
  else if (typeof w.percentUsed === "number") remainPct = Math.round(100 - w.percentUsed * 100);
  else remainPct = 100;

  const fmt = unit === "tokens" ? humanCount : (x: number) => String(x);
  return {
    label,
    remaining: remainPct,
    resetAt: nanoGptResetAt(w.resetAt),
    detail: total > 0 ? [`Used: ${fmt(used)} / ${fmt(total)}`] : [`Used: ${fmt(used)}`],
  };
}

async function queryNanoGptCredential(
  credential: NanoGptCredential,
  subtitle: string | undefined,
): Promise<ProviderCard> {
  const headers: Record<string, string> = {
    "x-api-key": credential.key,
    "Content-Type": "application/json",
    "User-Agent": "OpenCode-AllStatus/1.0",
  };

  const [balRes, subRes] = await Promise.all([
    fetchTimeout(`${NANOGPT_BASE_URL}/api/check-balance`, { method: "POST", headers }),
    fetchTimeout(`${NANOGPT_BASE_URL}/api/subscription/v1/usage`, { method: "GET", headers }),
  ]);

  if (!balRes.ok) {
    const body = await balRes.text().catch(() => "");
    throw new Error(`NanoGPT balance API error (${balRes.status}): ${body.slice(0, 200)}`);
  }
  const bal = (await balRes.json()) as NanoGptBalance;

  const header: string[] = [`Auth source:     ${nanoGptAuthSource(credential)}`];
  const usd = Number(bal.usd_balance ?? "0");
  header.push(`Balance:        $${(Number.isFinite(usd) ? usd : 0).toFixed(2)}`);
  const nano = Number(bal.nano_balance ?? "0");
  if (Number.isFinite(nano) && nano > 0) header.push(`Nano (XNO):     ${nano.toFixed(4)}`);

  let sub: NanoGptSubscription | null = null;
  if (subRes.ok) {
    try {
      sub = (await subRes.json()) as NanoGptSubscription;
    } catch {
      /* no subscription body */
    }
  }

  const windows: QuotaWindow[] = [];
  const footer: string[] = [];

  if (credential.cooldownUntil && credential.cooldownUntil > Date.now()) {
    footer.push(`Pool cooldown:  ${formatDuration(Math.ceil((credential.cooldownUntil - Date.now()) / 1000))}`);
  }

  if (sub?.active) {
    header.push(`Plan:           Subscription${sub.provider ? ` (${sub.provider})` : ""}`);
    const built = [
      nanoGptWindow("Weekly input tokens", sub.weeklyInputTokens, sub.limits?.weeklyInputTokens, "tokens"),
      nanoGptWindow("Daily input tokens", sub.dailyInputTokens, sub.limits?.dailyInputTokens, "tokens"),
      nanoGptWindow("Daily images", sub.dailyImages, sub.limits?.dailyImages, "images"),
    ];
    for (const w of built) if (w) windows.push(w);

    const end = sub.period?.currentPeriodEnd;
    if (end) footer.push(`${sub.cancelAtPeriodEnd ? "Ends" : "Renews"}:         ${formatResetAt(end)}`);
  } else {
    header.push("Plan:           Pay-as-you-go");
  }

  return { subtitle, header, windows, footer: footer.length ? footer : undefined };
}

type NanoGptQueryOutcome = { card: ProviderCard } | { error: string };

async function queryNanoGpt(
  auth: NanoGptAuthData | undefined,
  ansi = false,
): Promise<QueryResult | null> {
  const credentials = resolveNanoGptCredentials(auth);
  if (credentials.length === 0) return null;

  const multi = credentials.length > 1;
  const results: NanoGptQueryOutcome[] = await Promise.all(
    credentials.map(async (credential) => {
      const subtitle = nanoGptSubtitle(credential, multi);
      try {
        return { card: await queryNanoGptCredential(credential, subtitle) };
      } catch (err) {
        const label = subtitle ?? "NanoGPT";
        const message = err instanceof Error ? err.message : String(err);
        return { error: `${label}: ${message}` };
      }
    }),
  );

  const cards: ProviderCard[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if ("card" in result) {
      cards.push(result.card);
    } else {
      errors.push(result.error);
    }
  }

  if (cards.length > 0) {
    if (errors.length > 0) cards.push({ subtitle: multi ? "Errors" : undefined, header: errors });
    return { success: true, cards };
  }

  return { success: false, error: errors.join("\n\n") };
}

// ============================================================
// Grid rendering
// ============================================================

interface WindowMetric {
  cellTitle: string;
  label: string;
  remaining: number; // 0-100
  resetMs?: number; // ms until reset
}

interface GridCell {
  title: string;
  lines: string[];
  metrics?: WindowMetric[];
}

// Annotation hook: returns a trend line to insert under a window's bar.
type TrendFn = (
  cellTitle: string,
  label: string,
  remaining: number,
  resetMs: number | undefined,
) => string | null;

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

// Parse a "5d 2h 30m" / "4h" / "10m" / "now" / "resetting" countdown back to ms.
function parseResetToMs(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.trim().toLowerCase();
  if (t === "resetting" || t === "now" || t === "resets soon") return 0;
  let ms = 0;
  let matched = false;
  const re = /(\d+)\s*([dhm])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === "d" ? n * 86_400_000 : m[2] === "h" ? n * 3_600_000 : n * 60_000;
  }
  return matched ? ms : undefined;
}

// Resolve a window's countdown text + ms-until-reset from whatever it carries.
function windowReset(w: QuotaWindow): { text?: string; ms?: number } {
  if (w.resetText) return { text: w.resetText, ms: parseResetToMs(w.resetText) };
  if (w.resetAt) {
    const ms = new Date(w.resetAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return {};
    if (ms <= 0) return { text: "resetting", ms: 0 };
    return { text: formatDuration(Math.floor(ms / 1000)), ms };
  }
  if (typeof w.resetInSec === "number" && Number.isFinite(w.resetInSec)) {
    const s = Math.max(0, w.resetInSec);
    return { text: s <= 0 ? "resetting" : formatDuration(Math.floor(s)), ms: s * 1000 };
  }
  return {};
}

// Render a structured card into grid-cell lines + window metrics.
function cardToCell(
  card: ProviderCard,
  providerTitle: string,
  ansi: boolean,
  trend?: TrendFn,
): GridCell {
  const title = card.subtitle ? cellTitle(providerTitle, card.subtitle) : providerTitle;
  const lines: string[] = [];
  const metrics: WindowMetric[] = [];

  if (card.note) lines.push(ansi ? `${ANSI_DIM}${card.note}${ANSI_RESET}` : card.note);
  if (card.header?.length) lines.push(...card.header);

  let needBlank = lines.length > 0; // separate header/note from first window
  for (const w of card.windows ?? []) {
    if (needBlank) lines.push("");
    needBlank = true;

    if (w.label) lines.push(w.label);
    if (w.warn) lines.push(w.warn);

    const remain = Math.max(0, Math.min(100, Math.round(w.remaining)));
    const suffix = w.suffix ?? `${remain}% remaining`;
    lines.push(`${createProgressBar(remain, 26, ansi)} ${suffix}`);

    const { text: resetText, ms: resetMs } = windowReset(w);

    if (trend) {
      const annotation = trend(title, w.label, remain, resetMs);
      if (annotation) lines.push(annotation);
    }

    if (w.detail?.length) lines.push(...w.detail);
    if (resetText) lines.push(`Resets in: ${resetText}`);
    if (w.extra?.length) lines.push(...w.extra);

    if (w.label) metrics.push({ cellTitle: title, label: w.label, remaining: remain, resetMs });
  }

  if (card.footer?.length) {
    if (lines.length > 0) lines.push("");
    lines.push(...card.footer);
  }

  return { title, lines, metrics };
}

function collect(
  result: QueryResult | null,
  providerTitle: string,
  cells: GridCell[],
  errors: string[],
  ansi: boolean,
  trend?: TrendFn,
): void {
  if (!result) return;

  if (result.success && result.cards?.length) {
    for (const card of result.cards) {
      cells.push(cardToCell(card, providerTitle, ansi, trend));
    }
    return;
  }

  // Legacy free-form fallback (kept so unconverted output still renders).
  if (result.success && result.output) {
    const parts = result.output.split(/\n\n(?=### )/);
    if (parts.length > 1) {
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^### (.+)\n?([\s\S]*)/);
        if (m) {
          cells.push({ title: cellTitle(providerTitle, m[1].trim()), lines: (m[2] ?? "").split("\n") });
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
// Metrics, alerts & summary
// ============================================================

function gatherMetrics(cells: GridCell[]): WindowMetric[] {
  const all: WindowMetric[] = [];
  for (const c of cells) if (c.metrics?.length) all.push(...c.metrics);
  return all;
}

// Minimum remaining % for a cell (structured metrics, with a legacy parse fallback).
function cellMinRemaining(cell: GridCell): number {
  let min = 101;
  if (cell.metrics?.length) {
    for (const m of cell.metrics) min = Math.min(min, m.remaining);
  } else {
    for (const line of cell.lines) {
      const m = line.match(/(\d+)% (?:remaining|of)/);
      if (m) min = Math.min(min, parseInt(m[1], 10));
    }
  }
  return min;
}

// Soonest reset across a cell's windows (ms), if any.
function cellSoonestReset(cell: GridCell): number | undefined {
  let soonest: number | undefined;
  for (const m of cell.metrics ?? []) {
    if (typeof m.resetMs === "number" && (soonest === undefined || m.resetMs < soonest)) {
      soonest = m.resetMs;
    }
  }
  return soonest;
}

function extractAlerts(cells: GridCell[], threshold = 25): string[] {
  const alerts: string[] = [];
  for (const cell of cells) {
    const min = cellMinRemaining(cell);
    if (min > 0 && min <= threshold) alerts.push(`${cell.title}: ${min}%`);
  }
  return alerts;
}

// ============================================================
// JSON serialization
// ============================================================

function cellsToJson(cells: GridCell[], alerts: string[], errors: string[]): string {
  return JSON.stringify(
    {
      cells: cells.map((c) => ({
        title: c.title,
        lines: c.lines.map((l) => l.replace(ANSI_RE, "")),
        metrics: c.metrics?.length ? c.metrics : undefined,
      })),
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

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// Returns the number of terminal columns a string occupies.
// Wide characters (emoji, CJK, etc.) count as 2 columns; most others as 1.
function displayWidth(s: string): number {
  let w = 0;
  for (const cp of s) {
    const code = cp.codePointAt(0) ?? 0;
    // Emoji / pictographs / misc symbols that render as 2-wide in terminals
    if (
      (code >= 0x1f300 && code <= 0x1f9ff) || // Misc symbols, emoticons, transport, etc.
      (code >= 0x2600  && code <= 0x27bf) ||  // Misc symbols & dingbats
      (code >= 0xfe00  && code <= 0xfe0f) ||  // Variation selectors
      (code >= 0x1f000 && code <= 0x1f02f) || // Mahjong / domino
      (code >= 0x1fa00 && code <= 0x1fa9f) || // Chess / symbols
      (code >= 0x4e00  && code <= 0xa4ff) ||  // CJK unified ideographs
      (code >= 0xac00  && code <= 0xd7af) ||  // Hangul syllables
      (code >= 0x20000 && code <= 0x2a6df) || // CJK extension B
      (code >= 0x2f800 && code <= 0x2fa1f)    // CJK compatibility supplement
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padLine(s: string, w: number): string {
  const visual = stripAnsi(s);
  const vw = displayWidth(visual);

  if (vw > w) {
    let acc = 0;
    let cut = "";
    for (const cp of visual) {
      const cw = displayWidth(cp);
      if (acc + cw > w - 1) break;
      cut += cp;
      acc += cw;
    }
    cut += "\u2026";
    return cut + " ".repeat(Math.max(0, w - displayWidth(cut)));
  }

  return s + " ".repeat(Math.max(0, w - vw));
}

// ============================================================
// Single-column card layout
// ============================================================
//
// Every provider is rendered as its own full-width card, stacked vertically
// with internal padding and a blank line of breathing room between cards.
// Cards size to the target width (capped so they stay readable) and embedded
// progress bars are rescaled to fit, so borders stay aligned at any size.

const MIN_INNER = 30; // narrowest interior (between the │ borders)
const MAX_INNER = 66; // widest interior, so cards stay readable on big screens
const PAD_X = 2; // left/right interior padding
const DEFAULT_WIDTH = 100; // fallback when no width can be determined

// Rounded outer corners: a clean, modern card frame.
const BOX = {
  tl: "\u256d", // ╭
  tr: "\u256e", // ╮
  bl: "\u2570", // ╰
  br: "\u256f", // ╯
  h: "\u2500", // ─
  v: "\u2502", // │
};

// Truncate to a display width, appending an ellipsis when clipped.
function truncateW(s: string, w: number): string {
  if (displayWidth(s) <= w) return s;
  let acc = 0;
  let cut = "";
  for (const cp of s) {
    const cw = displayWidth(cp);
    if (acc + cw > w - 1) break;
    cut += cp;
    acc += cw;
  }
  return cut + "\u2026";
}

// Rescale an embedded progress bar (a run of █/░) to fit the space left in
// its panel, preserving the original fill ratio. Surrounding ANSI color
// codes and the emoji/label sit outside the glyph run, so they're untouched.
function fitBar(line: string, budget: number): string {
  const m = line.match(/[\u2588\u2591]+/);
  if (!m || m.index === undefined) return line;
  const run = m[0];
  const total = run.length;
  const filled = (run.match(/\u2588/g) ?? []).length;
  const ratio = total > 0 ? filled / total : 0;
  const before = line.slice(0, m.index);
  const after = line.slice(m.index + total);
  const rest = displayWidth(stripAnsi(before + after));
  const barW = Math.max(6, budget - rest);
  const nf = Math.round(ratio * barW);
  return before + "\u2588".repeat(nf) + "\u2591".repeat(Math.max(0, barW - nf)) + after;
}

function renderGrid(cells: GridCell[], termWidth: number): string {
  const innerW = Math.max(MIN_INNER, Math.min(MAX_INNER, termWidth - 2));
  const contentW = innerW - PAD_X * 2; // usable text width inside the padding
  const out: string[] = [];

  // A fully blank interior row, used for top/bottom vertical padding.
  const blankRow = BOX.v + " ".repeat(innerW) + BOX.v;

  for (const cell of cells) {
    // Header: ╭─ Title ─────────╮
    const title = truncateW(cell.title, innerW - 4);
    out.push(
      BOX.tl +
        BOX.h +
        " " +
        title +
        " " +
        BOX.h.repeat(Math.max(0, innerW - 3 - displayWidth(title))) +
        BOX.tr,
    );

    // Body with vertical padding and left/right interior padding.
    out.push(blankRow);
    for (const raw of cell.lines) {
      const line = fitBar(raw, contentW);
      out.push(
        BOX.v +
          " ".repeat(PAD_X) +
          padLine(line, contentW) +
          " ".repeat(PAD_X) +
          BOX.v,
      );
    }
    out.push(blankRow);

    // Footer: ╰──────────────────╯
    out.push(BOX.bl + BOX.h.repeat(innerW) + BOX.br);

    // Spacing between providers.
    out.push("");
  }

  return out.join("\n");
}

// ============================================================
// Configuration (~/.config/opencode/mystatus.json)
// ============================================================

interface MyStatusConfig {
  width?: number;
  sort?: "urgency" | "name" | "reset";
  summary?: boolean;
  trend?: "off" | "compact" | "full";
  cacheTtlSec?: number;
  historyMax?: number;
  historyMinIntervalSec?: number;
  providers?: { disabled?: string[]; order?: string[] };
}

function configFile(name: string): string {
  return join(homedir(), ".config", "opencode", name);
}

// Strip // line and /* */ block comments (string-aware) so the config file
// can be self-documenting like opencode's own .jsonc files.
function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      inLine = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

function loadConfig(): MyStatusConfig {
  try {
    const raw = readFileSync(configFile("mystatus.json"), "utf-8");
    return JSON.parse(stripJsonComments(raw)) as MyStatusConfig;
  } catch {
    return {};
  }
}

// Resolve render width: explicit arg → env → live TTY → config → safe default.
// The plugin runs in a non-TTY server process, so the override path matters
// more than auto-detection.
function resolveWidth(explicit: number | undefined, cfg: MyStatusConfig): number {
  const clamp = (n: number) => Math.max(24, Math.min(400, Math.floor(n)));
  if (typeof explicit === "number" && explicit > 0) return clamp(explicit);
  const env = process.env.MYSTATUS_WIDTH ?? process.env.COLUMNS;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return clamp(n);
  }
  const cols = (process.stdout as { columns?: number } | undefined)?.columns;
  if (typeof cols === "number" && cols > 0) return clamp(cols);
  if (typeof cfg.width === "number" && cfg.width > 0) return clamp(cfg.width);
  return DEFAULT_WIDTH;
}

// ============================================================
// Provider registry
// ============================================================

interface Provider {
  id: string;
  title: string;
  query: (auth: AuthData, ansi: boolean) => Promise<QueryResult | null>;
}

const PROVIDERS: Provider[] = [
  { id: "anthropic", title: "Anthropic Account Quota", query: (a, ansi) => queryAnthropic(a.anthropic, ansi) },
  { id: "byteplus", title: "BytePlus Coding Plan", query: (_a, ansi) => queryBytePlus(_a, ansi) },
  { id: "copilot", title: "GitHub Copilot Account Quota", query: (a, ansi) => queryCopilot(a["github-copilot"], ansi) },
  { id: "google", title: "Google Account Quota", query: (_a, ansi) => queryGoogle(ansi) },
  { id: "minimax", title: "MiniMax Token Plan", query: (a, ansi) => queryMiniMax(a["minimax-coding-plan"], ansi) },
  { id: "mistral", title: "Mistral Vibe Usage", query: (_a, ansi) => queryMistral(_a, ansi) },
  { id: "nanogpt", title: "NanoGPT Account Quota", query: (a, ansi) => queryNanoGpt(a["nano-gpt"], ansi) },
  { id: "openai", title: "OpenAI Account Quota", query: (a, ansi) => queryOpenAI(a.openai, ansi) },
  { id: "opencode-go", title: "OpenCode Go+Zen Account Quota", query: (a, ansi) => queryOpenCodeGoZen(a["opencode-go"], ansi) },
  { id: "poe", title: "Poe Account Quota", query: (a, ansi) => queryPoe(a.poe, ansi) },
  { id: "qwencloud", title: "QwenCloud Token Plan", query: (_a, ansi) => queryQwenCloud(ansi) },
  { id: "stepfun", title: "StepFun Token Plan", query: (_a, ansi) => queryStepFun(ansi) },
  { id: "xai", title: "xAI/Grok", query: (a) => queryXai(a["xai-oauth"] ?? a.xai) },
  { id: "zai", title: "Z.AI Coding Plan", query: (a, ansi) => queryZai(a["zai-coding-plan"], ansi) },
];

function splitIds(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function selectProviders(cfg: MyStatusConfig, only?: string, exclude?: string): Provider[] {
  const onlySet = only ? new Set(splitIds(only)) : null;
  const exclSet = new Set([
    ...(cfg.providers?.disabled ?? []).map((s) => s.toLowerCase()),
    ...splitIds(exclude),
  ]);
  let list = PROVIDERS.filter((p) => (!onlySet || onlySet.has(p.id)) && !exclSet.has(p.id));
  const order = cfg.providers?.order;
  if (order?.length) {
    const rank = new Map(order.map((id, i) => [id.toLowerCase(), i] as const));
    list = [...list].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  return list;
}

// ============================================================
// Per-provider cache (fallback) + bounded deadline
// ============================================================

interface CacheEntry {
  ts: number;
  result: QueryResult;
}
type CacheFile = Record<string, CacheEntry>;

function loadCache(): CacheFile {
  try {
    return JSON.parse(readFileSync(configFile("mystatus-cache.json"), "utf-8")) as CacheFile;
  } catch {
    return {};
  }
}
function saveCache(cache: CacheFile): void {
  try {
    writeFileSync(configFile("mystatus-cache.json"), JSON.stringify(cache));
  } catch {
    /* best-effort */
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`exceeded ${ms / 1000}s deadline`)), ms),
    ),
  ]);
}

function noteCards(result: QueryResult, note: string): QueryResult {
  if (!result.cards) return result;
  return { ...result, cards: result.cards.map((c) => ({ ...c, note: c.note ?? note })) };
}

interface RanProvider {
  title: string;
  result: QueryResult | null;
}

// Run one provider with a hard deadline; on failure fall back to a cached
// snapshot (annotated). Successful results refresh the cache.
async function runProvider(
  p: Provider,
  auth: AuthData,
  ansi: boolean,
  cache: CacheFile,
  ttlMs: number,
  fresh: boolean,
  deadlineMs: number,
): Promise<RanProvider> {
  const cached = cache[p.id];
  const ageNote = (ts: number) => `cached${formatCachedAgeMinutes(ts)}`;

  if (!fresh && ttlMs > 0 && cached && Date.now() - cached.ts < ttlMs) {
    return { title: p.title, result: noteCards(cached.result, ageNote(cached.ts)) };
  }

  try {
    const result = await withDeadline(p.query(auth, ansi), deadlineMs);
    if (result === null) return { title: p.title, result: null };
    if (result.success && result.cards) {
      cache[p.id] = { ts: Date.now(), result };
      return { title: p.title, result };
    }
    // Live attempt errored → fall back to a previous good snapshot if we have one.
    if (cached?.result.success) {
      return { title: p.title, result: noteCards(cached.result, ageNote(cached.ts)) };
    }
    return { title: p.title, result };
  } catch (err) {
    if (cached?.result.success) {
      return { title: p.title, result: noteCards(cached.result, ageNote(cached.ts)) };
    }
    return {
      title: p.title,
      result: { success: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ============================================================
// Usage history & trends
// ============================================================

interface HistorySnapshot {
  ts: number;
  values: Record<string, number>;
}
interface HistoryFile {
  version: number;
  snapshots: HistorySnapshot[];
}

function loadHistory(): HistoryFile {
  try {
    const h = JSON.parse(readFileSync(configFile("mystatus-history.json"), "utf-8")) as HistoryFile;
    if (h && Array.isArray(h.snapshots)) return h;
  } catch {
    /* no history yet */
  }
  return { version: 1, snapshots: [] };
}
function saveHistory(h: HistoryFile): void {
  try {
    writeFileSync(configFile("mystatus-history.json"), JSON.stringify(h));
  } catch {
    /* best-effort */
  }
}

// Ramp deliberately excludes █ (\u2588) and ░ (\u2591) so the renderer's
// progress-bar rescaler (fitBar) never mistakes a sparkline for a bar.
const SPARK = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587";
function sparkline(values: number[], ansi = false): string {
  return values
    .map((v) => {
      const idx = Math.round((Math.max(0, Math.min(100, v)) / 100) * 6);
      const char = SPARK[Math.max(0, Math.min(6, idx))];
      if (!ansi) return char;
      const color = v >= 50 ? ANSI_GREEN : v >= 25 ? ANSI_YELLOW : ANSI_RED;
      return `${color}${char}${ANSI_RESET}`;
    })
    .join("");
}

function buildSeries(h: HistoryFile): Map<string, { ts: number; value: number }[]> {
  const map = new Map<string, { ts: number; value: number }[]>();
  for (const snap of h.snapshots) {
    for (const [k, v] of Object.entries(snap.values)) {
      const arr = map.get(k);
      if (arr) arr.push({ ts: snap.ts, value: v });
      else map.set(k, [{ ts: snap.ts, value: v }]);
    }
  }
  return map;
}

function makeTrendFn(
  series: Map<string, { ts: number; value: number }[]>,
  mode: "off" | "compact" | "full",
  ansi: boolean,
  now: number,
): TrendFn {
  if (mode === "off") return () => null;
  return (cellTitle, label, remaining, resetMs) => {
    if (!label) return null;
    const hist = series.get(`${cellTitle}::${label}`) ?? [];
    const recent = [...hist.map((p) => p.value), remaining].slice(-10);
    const spark = recent.length >= 2 ? sparkline(recent, ansi) : "";

    const parts: string[] = [];
    if (hist.length > 0) {
      const prev = hist[hist.length - 1];
      const delta = remaining - prev.value;
      const ageMs = now - prev.ts;
      const ageStr = mode === "full" ? `/${formatDuration(Math.floor(ageMs / 1000))}` : "";

      if (delta > 5) parts.push("\u2191 reset");
      else if (delta >= 1) parts.push(`\u25b2${delta}%${ageStr}`);
      else if (delta <= -1) parts.push(`\u25bc${Math.abs(delta)}%${ageStr}`);
      else parts.push("\u2192 0%");

      if (spark) parts.push(spark);

      if (mode === "full" && delta < 0 && ageMs > 0) {
        const ratePerMs = (prev.value - remaining) / ageMs; // %/ms
        if (ratePerMs > 0) {
          const msToEmpty = remaining / ratePerMs;
          if (resetMs === undefined || msToEmpty < resetMs) {
            parts.push(`~${formatDuration(Math.floor(msToEmpty / 1000))} to empty`);
          }
        }
      }
    } else if (spark) {
      parts.push(spark);
    }

    if (parts.length === 0) return null;
    const text = `   ${parts.join(" ")}`;
    return text;
  };
}

function recordSnapshot(
  history: HistoryFile,
  metrics: WindowMetric[],
  cfg: MyStatusConfig,
  now: number,
): void {
  const minIntervalMs = (cfg.historyMinIntervalSec ?? 60) * 1000;
  const last = history.snapshots[history.snapshots.length - 1];
  if (last && now - last.ts < minIntervalMs) return;

  const values: Record<string, number> = {};
  for (const m of metrics) values[`${m.cellTitle}::${m.label}`] = m.remaining;
  if (Object.keys(values).length === 0) return;

  history.snapshots.push({ ts: now, values });
  const max = Math.max(2, cfg.historyMax ?? 60);
  if (history.snapshots.length > max) history.snapshots = history.snapshots.slice(-max);
  saveHistory(history);
}

// ============================================================
// Summary card + sorting
// ============================================================

function buildSummaryCell(
  cells: GridCell[],
  metrics: WindowMetric[],
  threshold: number,
  ansi: boolean,
): GridCell {
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const cell of cells) {
    const min = cellMinRemaining(cell);
    if (min > 100) continue;
    if (min >= 50) green++;
    else if (min >= threshold) yellow++;
    else red++;
  }

  let lowest: WindowMetric | undefined;
  for (const m of metrics) if (!lowest || m.remaining < lowest.remaining) lowest = m;

  let soonest: WindowMetric | undefined;
  for (const m of metrics) {
    if (typeof m.resetMs === "number" && (!soonest || (soonest.resetMs ?? Infinity) > m.resetMs)) {
      soonest = m;
    }
  }

  const header: string[] = [
    `Accounts:       ${cells.length}   \ud83d\udfe9 ${green}  \ud83d\udfe8 ${yellow}  \ud83d\udfe7 ${red}`,
  ];
  if (lowest) {
    header.push(`Lowest:         ${lowest.cellTitle} \u00b7 ${lowest.label}  ${lowest.remaining}%`);
  }
  if (soonest && typeof soonest.resetMs === "number") {
    header.push(
      `Soonest reset:  ${soonest.cellTitle} \u00b7 ${soonest.label}  ${formatDuration(Math.floor(soonest.resetMs / 1000))}`,
    );
  }
  return cardToCell({ header }, "Summary", ansi);
}

function sortCells(cells: GridCell[], mode: "urgency" | "name" | "reset"): void {
  if (mode === "name") {
    cells.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  } else if (mode === "reset") {
    cells.sort((a, b) => (cellSoonestReset(a) ?? Infinity) - (cellSoonestReset(b) ?? Infinity));
  } else {
    cells.sort((a, b) => {
      const ra = cellMinRemaining(a);
      const rb = cellMinRemaining(b);
      const na = ra > 100 ? 101 : ra;
      const nb = rb > 100 ? 101 : rb;
      if (na !== nb) return na - nb;
      const sa = cellSoonestReset(a) ?? Infinity;
      const sb = cellSoonestReset(b) ?? Infinity;
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }
}

// ============================================================
// Core runner
// ============================================================

interface MyStatusArgs {
  format?: string;
  threshold?: number;
  width?: number;
  sort?: string;
  summary?: boolean;
  trend?: string;
  only?: string;
  exclude?: string;
  fresh?: boolean;
}

async function runMyStatus(args: MyStatusArgs): Promise<string> {
  const now = Date.now();
  const cfg = loadConfig();

  const format = args.format ?? "ansi";
  const isJson = format === "json";
  const useAnsi = !isJson;
  const threshold = args.threshold ?? 25;
  const termWidth = resolveWidth(args.width, cfg);
  const sortMode = (args.sort ?? cfg.sort ?? "urgency") as "urgency" | "name" | "reset";
  const showSummary = (args.summary ?? cfg.summary ?? true) && !isJson;
  const trendMode = (isJson ? "off" : (args.trend ?? cfg.trend ?? "compact")) as
    | "off"
    | "compact"
    | "full";
  const cacheTtlMs = Math.max(0, cfg.cacheTtlSec ?? 0) * 1000;
  const fresh = args.fresh === true;

  const authPath = authJsonPath();
  let auth: AuthData = {};
  try {
    const raw = await readFile(authPath, "utf-8");
    auth = JSON.parse(raw) as AuthData;
  } catch (err) {
    return `\u274c Failed to read auth file: ${authPath}\n${err instanceof Error ? err.message : String(err)}`;
  }

  const providers = selectProviders(cfg, args.only, args.exclude);
  const cache = loadCache();
  const ran = await Promise.all(
    providers.map((p) => runProvider(p, auth, useAnsi, cache, cacheTtlMs, fresh, 15_000)),
  );
  saveCache(cache);

  // Build trend annotations from prior history, record the new snapshot after.
  const history = loadHistory();
  const trend = makeTrendFn(buildSeries(history), trendMode, useAnsi, now);

  const cells: GridCell[] = [];
  const errors: string[] = [];
  for (const { title, result } of ran) {
    collect(result, title, cells, errors, useAnsi, trend);
  }

  if (cells.length === 0) {
    return errors.length
      ? `\u274c Failed to query:\n${errors.join("\n\n")}`
      : "No accounts found.";
  }

  const metrics = gatherMetrics(cells);
  recordSnapshot(history, metrics, cfg, now);

  const alerts = extractAlerts(cells, threshold);

  if (isJson) {
    return cellsToJson(cells, alerts, errors);
  }

  sortCells(cells, sortMode);
  if (showSummary) cells.unshift(buildSummaryCell(cells, metrics, threshold, useAnsi));

  let output = renderGrid(cells, termWidth).trimEnd();

  if (alerts.length > 0) {
    if (useAnsi) {
      output += `\n\n${ANSI_BOLD}${ANSI_RED}\u26a0\ufe0f Low quota alerts:${ANSI_RESET}`;
      for (const alert of alerts) output += `\n${ANSI_RED}  \u2022 ${alert}${ANSI_RESET}`;
    } else {
      output += `\n\n\u26a0\ufe0f Low quota alerts:`;
      for (const alert of alerts) output += `\n  \u2022 ${alert}`;
    }
  }

  if (errors.length) {
    output += `\n\n\u274c Failed to query:\n${errors.join("\n\n")}`;
  }

  return output;
}

// ============================================================
// Plugin entry point
// ============================================================

export const MyStatusPlugin: Plugin = async () => ({
  tool: {
    mystatus: tool({
      description:
        "Query quota usage for all configured AI platforms. Returns remaining quota, usage stats, and reset countdowns. Supports OpenAI, Anthropic, Google (Antigravity), GitHub Copilot, OpenCode Go+Zen, Poe, Z.AI (GLM Coding Plan), xAI/Grok, MiniMax Token Plan, NanoGPT, StepFun Token Plan, QwenCloud Token Plan, Mistral Vibe, and BytePlus Coding Plan. Output is a single-column stack of provider cards, sorted by urgency, with a summary card and usage trends. Pass `width` with the user's terminal column count (or set MYSTATUS_WIDTH / a width in ~/.config/opencode/mystatus.json) so cards size to the terminal and never wrap. Optional args: sort (urgency|name|reset), summary (bool), trend (off|compact|full), only/exclude (comma provider ids: anthropic,byteplus,copilot,google,minimax,mistral,nanogpt,openai,opencode-go,poe,qwencloud,stepfun,xai,zai), fresh (bool), threshold (number), format (ansi|json).",
      args: {
        format: tool.schema.string().optional(),
        threshold: tool.schema.number().optional(),
        width: tool.schema.number().optional(),
        sort: tool.schema.string().optional(),
        summary: tool.schema.boolean().optional(),
        trend: tool.schema.string().optional(),
        only: tool.schema.string().optional(),
        exclude: tool.schema.string().optional(),
        fresh: tool.schema.boolean().optional(),
      },
      async execute(args) {
        return runMyStatus(args);
      },
    }),
  },
});
