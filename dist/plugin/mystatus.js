/**
 * allstatus.ts — All-in-one AI quota status plugin for OpenCode
 *
 * Platforms:
 *   - OpenAI      (ChatGPT Plus/Team/Pro)    auth.json → openai
 *   - Anthropic   (Claude.ai)               auth.json → anthropic
 *   - Google      (Antigravity quota/usage)  Antigravity Tools API → antigravity-accounts.json fallback
 *   - GitHub Copilot                        auth.json → github-copilot (+ optional PAT)
 *   - OpenCode Go+Zen (merged cell)         shared dashboard config (workspaceId + authCookie)
 *   - Poe         (points balance)          auth.json, env var, or poe-api-key.json
 *   - Z.AI        (GLM Coding Plan)         auth.json → zai-coding-plan
 *   - xAI/Grok    (SuperGrok weekly/monthly usage + extra credits)  auth.json → xai/xai-oauth (dev) + ~/.grok/auth.json (consumer, auto-refreshed) via cli-chat-proxy /v1/billing[?format=credits]
 *   - MiniMax     (Token Plan)              auth.json → minimax-coding-plan (Anthropic-compatible)
 *   - NanoGPT     (balance + subscription)  auth.json → nano-gpt OR nanogpt-keys.json
 *   - StepFun     (Token Plan)              stepfun-cookies.json → dashboard API
 *   - QwenCloud   (Token Plan)              qwencloud-cookies.json → dashboard API
 *   - BytePlus    (Ark Coding Plan)         byteplus-cookies.json → console API
 *   - AtlasCloud  (Coding Plan)             atlas-cookies.json → console API
 *   - Ollama      (Cloud Pro/Max)             ollama-cookies.json → settings SSR
 *   - LongCat     (API token quota)           longcat-cookies.json → platform API
 *
 * Features:
 *   - ANSI color-coded progress bars (red/yellow/green)
 *   - Zen per-model cost breakdown from usage page SSR
 *   - Threshold alerts for low-remaining platforms
 *   - JSON output mode for programmatic consumption
 *   - Go + Zen merged into single cell per account
 */
import { tool } from "@opencode-ai/plugin";
import { readFile } from "fs/promises";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "fs";
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
function colorForPercent(pct) {
    if (pct <= 0)
        return ANSI_RED;
    if (pct < 25)
        return ANSI_RED;
    if (pct < 50)
        return ANSI_YELLOW;
    return ANSI_GREEN;
}
function emojiForPercent(pct) {
    if (pct <= 0)
        return "\ud83d\udfe5"; // red square
    if (pct < 25)
        return "\ud83d\udfe7"; // orange square
    if (pct < 50)
        return "\ud83d\udfe8"; // yellow square
    return "\ud83d\udfe9"; // green square
}
// ============================================================
// Shared utilities
// ============================================================
function createProgressBar(remainPercent, width = 26, useAnsi = false) {
    const p = Math.max(0, Math.min(100, remainPercent));
    const filled = Math.round((p / 100) * width);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
    const emoji = emojiForPercent(p);
    if (!useAnsi)
        return `${emoji} ${bar}`;
    return `${emoji} ${colorForPercent(p)}${bar}${ANSI_RESET}`;
}
function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
}
function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds))
        return "-";
    totalSeconds = Math.max(0, totalSeconds);
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];
    if (d > 0)
        parts.push(`${d}d`);
    if (h > 0)
        parts.push(`${h}h`);
    if (m > 0 || parts.length === 0)
        parts.push(`${m}m`);
    return parts.join(" ");
}
function formatResetAt(isoTime) {
    if (!isoTime)
        return "-";
    try {
        const timestamp = new Date(isoTime).getTime();
        if (!Number.isFinite(timestamp))
            return "-";
        const diffMs = timestamp - Date.now();
        if (diffMs <= 0)
            return "resetting";
        return formatDuration(Math.floor(diffMs / 1000));
    }
    catch {
        return "-";
    }
}
// Provider dashboards are inconsistent about epoch precision. Normalize the
// common seconds, milliseconds, and microseconds forms before constructing a
// Date so a valid timestamp cannot silently render in 1970 or the far future.
function epochToMs(raw) {
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        return undefined;
    if (value < 10_000_000_000)
        return value * 1000;
    if (value > 10_000_000_000_000)
        return Math.floor(value / 1000);
    return value;
}
function epochToIso(raw) {
    const ms = epochToMs(raw);
    if (ms === undefined)
        return undefined;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffDelay = (attempt) => 300 * 2 ** attempt + Math.floor(Math.random() * 150);
// GET-style fetch with a per-attempt timeout and bounded retries. Retries on
// 429/5xx (honoring Retry-After) and fast network errors with exponential
// backoff + jitter. Timeouts are NOT retried (they'd multiply latency).
async function fetchTimeout(url, options, ms = 10_000, retries = 2) {
    let lastErr;
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
        }
        catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                throw new Error(`Request timed out after ${ms / 1000}s`);
            }
            lastErr = err;
            if (attempt < retries) {
                await sleep(backoffDelay(attempt));
                continue;
            }
            throw err;
        }
        finally {
            clearTimeout(id);
        }
    }
    throw lastErr ?? new Error("fetch failed after retries");
}
// ============================================================
// Paths
// ============================================================
function authJsonPath() {
    return findReadable("auth.json", "data") ?? opencodeDataFile("auth.json");
}
function opencodeDataFile(name) {
    if (process.env.XDG_DATA_HOME) {
        return join(process.env.XDG_DATA_HOME, "opencode", name);
    }
    return join(homedir(), ".local", "share", "opencode", name);
}
function nanoGptMultiAuthKeysPath() {
    return findReadable("nanogpt-keys.json", "data") ?? opencodeDataFile("nanogpt-keys.json");
}
function opencodeConfigDir() {
    if (process.env.OPENCODE_CONFIG_DIR)
        return process.env.OPENCODE_CONFIG_DIR;
    return join(homedir(), ".config", "opencode");
}
// ─────────────────────────────────────────────────────────────
// opencode-multi profile discovery + multi-profile path resolution
//
// opencode-multi lays out profiles at ~/Library/Application Support/
// opencode-multi/profiles/<name>/ and exports OPENCODE_CONFIG_DIR /
// XDG_DATA_HOME at session start. The plugin used to hardcode legacy
// ~/.config/opencode and ~/.local/share/opencode paths, missing per-profile
// auth and double-counting accounts replicated across profiles. The helpers
// below resolve to the active profile first, fall back to sibling profiles,
// and dedup credentials across them so a single account isn't shown twice
// when the same auth.json is mirrored into multiple profile dirs.
// ─────────────────────────────────────────────────────────────
const OPENCODE_MULTI_PROFILES_ROOT = join(homedir(), "Library", "Application Support", "opencode-multi", "profiles");
function listProfileDirs() {
    try {
        return readdirSync(OPENCODE_MULTI_PROFILES_ROOT, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name !== "opencode")
            .map((d) => {
            const p = join(OPENCODE_MULTI_PROFILES_ROOT, d.name);
            try {
                return realpathSync(p);
            }
            catch {
                return p;
            }
        });
    }
    catch {
        return [];
    }
}
function candidateDirs(kind) {
    const seen = new Set();
    const out = [];
    const add = (p) => {
        if (!p)
            return;
        let real;
        try {
            real = realpathSync(p);
        }
        catch {
            real = p;
        }
        if (seen.has(real))
            return;
        seen.add(real);
        out.push(real);
    };
    if (kind === "config" && process.env.OPENCODE_CONFIG_DIR)
        add(process.env.OPENCODE_CONFIG_DIR);
    if (kind === "data" && process.env.XDG_DATA_HOME)
        add(join(process.env.XDG_DATA_HOME, "opencode"));
    for (const p of listProfileDirs())
        add(p);
    if (kind === "config")
        add(join(homedir(), ".config", "opencode"));
    if (kind === "data")
        add(join(homedir(), ".local", "share", "opencode"));
    return out;
}
function searchPaths(filename, kind) {
    return candidateDirs(kind)
        .map((d) => join(d, filename))
        .filter((p) => existsSync(p));
}
function findReadable(filename, kind) {
    const found = searchPaths(filename, kind);
    return found[0] ?? null;
}
function stableCredHash(cred) {
    const c = (cred ?? {});
    if (c.type === "oauth") {
        const tok = String(c.access ?? c.accessToken ?? c.refresh ?? "");
        return `oauth:${tok.slice(0, 32)}`;
    }
    if (c.type === "api") {
        const key = String(c.key ?? c.apiKey ?? "");
        return `api:${key.slice(-16)}`;
    }
    return `raw:${JSON.stringify(c).slice(0, 96)}`;
}
async function loadAuthMerged() {
    const paths = searchPaths("auth.json", "data");
    const merged = {};
    // Per-provider freshness merge: for the same provider id across multiple
    // auth.json sources (profiles + legacy), keep the entry with the latest
    // `expires`. Prevents a stale legacy ~/.local/share copy from shadowing
    // the fresh per-profile token written by the active opencode-multi
    // profile. Falls back to first-match for non-oauth entries.
    for (const p of paths) {
        try {
            const raw = await readFile(p, "utf-8");
            const data = JSON.parse(raw);
            for (const [provider, cred] of Object.entries(data)) {
                const existing = merged[provider];
                if (!existing) {
                    merged[provider] = cred;
                    continue;
                }
                const existingExp = oauthExpires(existing);
                const candidateExp = oauthExpires(cred);
                if (candidateExp !== undefined && (existingExp === undefined || candidateExp > existingExp)) {
                    merged[provider] = cred;
                }
            }
        }
        catch {
            // unreadable / malformed — skip
        }
    }
    return merged;
}
function oauthExpires(cred) {
    if (!cred || typeof cred !== "object")
        return undefined;
    const c = cred;
    if (c.type !== "oauth")
        return undefined;
    const e = c.expires;
    return typeof e === "number" && Number.isFinite(e) ? e : undefined;
}
function googleRefreshFromCred(cred) {
    const refresh = cred?.refresh;
    if (!refresh)
        return null;
    const [token] = refresh.split("|");
    return token || null;
}
async function collectGoogleAuthRefreshTokens() {
    const tokens = new Set();
    for (const p of searchPaths("auth.json", "data")) {
        try {
            const data = JSON.parse(await readFile(p, "utf-8"));
            for (const [provider, cred] of Object.entries(data)) {
                if (provider !== "google")
                    continue;
                const token = googleRefreshFromCred(cred);
                if (token)
                    tokens.add(token);
            }
        }
        catch {
            // skip
        }
    }
    return tokens;
}
function antigravityAccountFreshness(a) {
    return Math.max(a.lastUsed ?? 0, a.cachedQuotaUpdatedAt ?? 0, a.addedAt ?? 0);
}
function mergeAntigravityAccount(existing, candidate) {
    const pick = antigravityAccountFreshness(candidate) >= antigravityAccountFreshness(existing)
        ? candidate
        : existing;
    const other = pick === candidate ? existing : candidate;
    return {
        ...other,
        ...pick,
        cachedQuota: pick.cachedQuota ?? other.cachedQuota,
        cachedQuotaUpdatedAt: pick.cachedQuotaUpdatedAt ?? other.cachedQuotaUpdatedAt,
        fingerprint: pick.fingerprint ?? other.fingerprint,
        projectId: pick.projectId ?? other.projectId,
        managedProjectId: pick.managedProjectId ?? other.managedProjectId,
        enabled: pick.enabled !== false && other.enabled !== false,
    };
}
async function loadAntigravityAccountsMerged(cfg = {}) {
    const paths = searchPaths("antigravity-accounts.json", "config");
    const authTokens = await collectGoogleAuthRefreshTokens();
    const excluded = new Set((cfg.google?.excludeEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
    const byEmail = new Map();
    for (const p of paths) {
        try {
            const raw = await readFile(p, "utf-8");
            const file = JSON.parse(raw);
            for (const a of file.accounts ?? []) {
                const email = (a.email ?? "").trim().toLowerCase();
                if (!email || a.enabled === false || excluded.has(email))
                    continue;
                const existing = byEmail.get(email);
                if (existing) {
                    existing.profileCount += 1;
                    existing.account = mergeAntigravityAccount(existing.account, a);
                }
                else {
                    byEmail.set(email, { account: a, profileCount: 1 });
                }
            }
        }
        catch {
            // skip
        }
    }
    return [...byEmail.values()]
        .filter(({ account, profileCount }) => {
        if (authTokens.has(account.refreshToken))
            return true;
        // Pool accounts mirrored across profiles (e.g. mattg4542) stay visible;
        // single-profile orphans (removed auth, stale workspace copy) drop out.
        return profileCount >= 2;
    })
        .map(({ account }) => account);
}
// ============================================================
// OpenAI
// ============================================================
function parseJwtPayload(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            return null;
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    }
    catch {
        return null;
    }
}
function openAIWindowLabel(seconds, fallback) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
        return fallback;
    if (seconds >= 86_400)
        return `${Math.round(seconds / 86_400)}-day limit`;
    if (seconds >= 3_600)
        return `${Math.round(seconds / 3_600)}-hour limit`;
    return `${Math.max(1, Math.round(seconds / 60))}-minute limit`;
}
function openAIWindow(w, scope, fallback = "Usage limit") {
    const baseLabel = openAIWindowLabel(w.limit_window_seconds, fallback);
    const label = scope && scope.trim()
        ? `${scope.trim()} — ${baseLabel}`
        : baseLabel;
    const resetAt = typeof w.reset_at === "number" && Number.isFinite(w.reset_at) && w.reset_at > 0
        ? new Date(w.reset_at * 1000).toISOString()
        : undefined;
    return {
        label,
        remaining: Math.round(clampPercent(100 - w.used_percent)),
        resetAt,
        resetInSec: resetAt === undefined && typeof w.reset_after_seconds === "number"
            ? w.reset_after_seconds
            : undefined,
    };
}
function openAIApproximateMessageRange(label, range) {
    if (!Array.isArray(range))
        return null;
    const values = range.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (!values.length || values.every((value) => value <= 0))
        return null;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const value = low === high ? low.toLocaleString() : `${low.toLocaleString()}–${high.toLocaleString()}`;
    return `${label}: ~${value}`;
}
function appendOpenAIRateLimitWindows(windows, rateLimit, scope) {
    if (!rateLimit)
        return;
    const start = windows.length;
    if (rateLimit.primary_window && typeof rateLimit.primary_window.used_percent === "number") {
        windows.push(openAIWindow(rateLimit.primary_window, scope, "Primary limit"));
    }
    if (rateLimit.secondary_window && typeof rateLimit.secondary_window.used_percent === "number") {
        windows.push(openAIWindow(rateLimit.secondary_window, scope, "Secondary limit"));
    }
    if ((rateLimit.limit_reached || rateLimit.allowed === false) && windows.length > start) {
        windows[start].warn = `⚠️ ${scope ? `${scope} quota` : "Rate limit"} reached`;
    }
}
function openAIAdditionalLimitName(limit, index) {
    const name = limit.limit_name?.trim();
    if (name)
        return name;
    const feature = limit.metered_feature?.trim();
    if (feature && !/^codex(?:_[a-z]+)?$/i.test(feature)) {
        return feature
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }
    return `Additional quota ${index + 1}`;
}
async function queryOpenAI(auth, ansi = false) {
    if (!auth || auth.type !== "oauth" || !auth.access)
        return null;
    if (auth.expires && auth.expires < Date.now())
        return { success: false, error: "\u26a0\ufe0f OpenAI token expired. Use an OpenAI model in OpenCode to refresh." };
    try {
        const payload = parseJwtPayload(auth.access);
        const email = payload?.["https://api.openai.com/profile"]?.email ?? null;
        const accountId = payload?.["https://api.openai.com/auth"]
            ?.chatgpt_account_id ?? null;
        const headers = {
            Authorization: `Bearer ${auth.access}`,
            "User-Agent": "OpenCode-AllStatus/1.0",
        };
        if (accountId)
            headers["ChatGPT-Account-Id"] = accountId;
        const res = await fetchTimeout("https://chatgpt.com/backend-api/wham/usage", { headers });
        if (!res.ok)
            throw new Error(`OpenAI API error (${res.status})`);
        const data = (await res.json());
        const header = [
            `Account:        ${data.email ?? email ?? "unknown"}`,
            `Plan:           ChatGPT ${data.plan_type ?? "unknown"}`,
        ];
        const credits = data.credits;
        if (credits) {
            if (credits.unlimited) {
                header.push("Credits:        unlimited");
            }
            else if (credits.has_credits || (credits.balance && credits.balance !== "0")) {
                header.push(`Credits:        ${credits.balance ?? "?"}`);
            }
            if (credits.overage_limit_reached)
                header.push("Overage:        \u26a0\ufe0f limit reached");
        }
        const windows = [];
        appendOpenAIRateLimitWindows(windows, data.rate_limit);
        appendOpenAIRateLimitWindows(windows, data.code_review_rate_limit, "Code review");
        for (const [index, additional] of (data.additional_rate_limits ?? []).entries()) {
            appendOpenAIRateLimitWindows(windows, additional.rate_limit, openAIAdditionalLimitName(additional, index));
        }
        const footer = [];
        const localMessages = openAIApproximateMessageRange("Approx. local messages", credits?.approx_local_messages);
        const cloudMessages = openAIApproximateMessageRange("Approx. cloud messages", credits?.approx_cloud_messages);
        if (localMessages)
            footer.push(localMessages);
        if (cloudMessages)
            footer.push(cloudMessages);
        if (data.spend_control?.reached) {
            footer.push("⚠️ Spend control reached");
        }
        else if (typeof data.spend_control?.individual_limit === "number" ||
            typeof data.spend_control?.individual_limit === "string") {
            footer.push(`Spend control: ${data.spend_control.individual_limit}`);
        }
        const resetCredits = data.rate_limit_reset_credits;
        const availableResetCredits = resetCredits?.available_count ?? 0;
        const applicableResetCredits = resetCredits?.applicable_available_count ?? 0;
        if (availableResetCredits > 0) {
            footer.push(`Rate-limit resets: ${applicableResetCredits} applicable / ${availableResetCredits} available`);
        }
        if (data.rate_limit?.limit_reached) {
            const reason = data.rate_limit_reached_type?.type
                ? ` (${data.rate_limit_reached_type.type})`
                : "";
            footer.push(`\u26a0\ufe0f Rate limit reached!${reason}`);
        }
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
// ============================================================
// Anthropic  (api.anthropic.com/api/oauth/usage — Claude Code internal endpoint)
// ============================================================
const ANTHROPIC_CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20";
const ANTHROPIC_USER_AGENT = "claude-code/1.0.17";
function anthropicWindow(label, w) {
    return {
        label,
        remaining: Math.round(clampPercent(100 - w.utilization)),
        resetAt: w.resets_at,
    };
}
function anthropicScopeValue(value) {
    if (typeof value === "string")
        return value.trim() || null;
    if (!value)
        return null;
    return value.display_name?.trim() || value.id?.trim() || null;
}
function anthropicLimitLabel(limit) {
    const kind = (limit.kind ?? "").trim().toLowerCase();
    const group = (limit.group ?? "").trim().toLowerCase();
    const scope = [
        anthropicScopeValue(limit.scope?.model),
        anthropicScopeValue(limit.scope?.surface),
    ].filter((value) => Boolean(value)).join(" · ");
    if (kind === "session" || group === "session") {
        return scope ? `5-hour (${scope})` : "5-hour limit";
    }
    if (kind.startsWith("weekly") || group === "weekly") {
        return scope ? `7-day (${scope})` : "7-day limit";
    }
    const raw = kind || group || "usage";
    const name = raw
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
    return scope ? `${name} (${scope})` : `${name} limit`;
}
function anthropicLimitWindow(limit) {
    if (typeof limit.percent !== "number" || !Number.isFinite(limit.percent))
        return null;
    let resetAt;
    if (typeof limit.resets_at === "string" && Number.isFinite(Date.parse(limit.resets_at))) {
        resetAt = limit.resets_at;
    }
    else if (typeof limit.resets_at === "number" && Number.isFinite(limit.resets_at)) {
        resetAt = new Date(limit.resets_at * (limit.resets_at < 10_000_000_000 ? 1000 : 1)).toISOString();
    }
    const severity = (limit.severity ?? "").toLowerCase();
    return {
        label: anthropicLimitLabel(limit),
        remaining: Math.round(clampPercent(100 - limit.percent)),
        resetAt,
        warn: /critical|exhausted|blocked/.test(severity) ? `⚠️ ${limit.severity}` : undefined,
    };
}
function anthropicMoneyValue(value) {
    if (typeof value?.amount_minor !== "number" || !Number.isFinite(value.amount_minor))
        return null;
    const exponent = typeof value.exponent === "number" && Number.isFinite(value.exponent)
        ? Math.max(0, Math.min(8, Math.round(value.exponent)))
        : 2;
    return value.amount_minor / 10 ** exponent;
}
function formatAnthropicMoney(value) {
    const amount = anthropicMoneyValue(value);
    if (amount === null)
        return null;
    const currency = value?.currency?.trim().toUpperCase() || "USD";
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }
    catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}
function appendAnthropicSpend(windows, footer, spend) {
    if (!spend)
        return false;
    const usedAmount = anthropicMoneyValue(spend.used);
    const used = formatAnthropicMoney(spend.used);
    const limit = formatAnthropicMoney(spend.limit);
    const balance = formatAnthropicMoney(spend.balance);
    const cap = formatAnthropicMoney(spend.cap);
    const hasPercent = typeof spend.percent === "number" && Number.isFinite(spend.percent);
    const hasData = Boolean(spend.enabled ||
        limit ||
        balance ||
        cap ||
        (usedAmount !== null && usedAmount !== 0) ||
        (hasPercent && spend.percent !== 0));
    if (!hasData)
        return false;
    if (hasPercent && (spend.enabled || limit)) {
        const detail = [];
        if (used && limit)
            detail.push(`Used: ${used} / ${limit}`);
        else if (used)
            detail.push(`Used: ${used}`);
        const severity = (spend.severity ?? "").toLowerCase();
        windows.push({
            label: "Extra usage spend",
            remaining: Math.round(clampPercent(100 - spend.percent)),
            detail: detail.length ? detail : undefined,
            warn: /critical|exhausted|blocked/.test(severity)
                ? `⚠️ ${spend.severity}`
                : undefined,
        });
    }
    else if (used) {
        footer.push(`Extra usage spent: ${used}`);
    }
    if (balance)
        footer.push(`Usage-credit balance: ${balance}`);
    if (cap && cap !== limit)
        footer.push(`Extra-usage cap: ${cap}`);
    if (spend.enabled === false && spend.disabled_reason) {
        footer.push(`Extra usage disabled: ${spend.disabled_reason}`);
    }
    return true;
}
function isAnthropicWindow(value) {
    return Boolean(value &&
        typeof value === "object" &&
        typeof value.utilization === "number" &&
        typeof value.resets_at === "string");
}
function anthropicLegacyWindowLabel(key) {
    if (key === "five_hour")
        return "5-hour limit";
    if (key === "seven_day")
        return "7-day limit";
    if (key.startsWith("seven_day_")) {
        const scope = key
            .slice("seven_day_".length)
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase());
        return `7-day (${scope})`;
    }
    return key
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
}
async function refreshAnthropicToken(refreshToken) {
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
        if (!res.ok)
            return null;
        const data = (await res.json());
        return data.access_token ?? null;
    }
    catch {
        return null;
    }
}
async function queryAnthropic(auth, ansi = false) {
    if (!auth || auth.type !== "oauth")
        return null;
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
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            "anthropic-beta": ANTHROPIC_BETA_HEADER,
            "User-Agent": ANTHROPIC_USER_AGENT,
            "Content-Type": "application/json",
        };
        const res = await fetchTimeout("https://api.anthropic.com/api/oauth/usage", { method: "GET", headers });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`);
        }
        const data = (await res.json());
        const header = ["Account:        Claude Pro/Max"];
        const windows = [];
        for (const limit of data.limits ?? []) {
            const window = anthropicLimitWindow(limit);
            if (window)
                windows.push(window);
        }
        // Older Claude usage responses exposed one fixed property per window.
        // Keep a dynamic compatibility path so newly added model/surface fields do
        // not need a plugin release even when the canonical `limits` array is absent.
        if (!windows.length) {
            for (const [key, value] of Object.entries(data)) {
                if (!isAnthropicWindow(value))
                    continue;
                windows.push(anthropicWindow(anthropicLegacyWindowLabel(key), value));
            }
        }
        const footer = [];
        const extra = data.extra_usage;
        if (isAnthropicWindow(extra?.daily)) {
            windows.push(anthropicWindow("Extra usage — Daily", extra.daily));
        }
        if (isAnthropicWindow(extra?.weekly)) {
            windows.push(anthropicWindow("Extra usage — Weekly", extra.weekly));
        }
        const usedCanonicalSpend = appendAnthropicSpend(windows, footer, data.spend);
        if (!usedCanonicalSpend && extra?.is_enabled) {
            const cur = extra.currency ?? "USD";
            const used = extra.used_credits ?? 0;
            const limit = extra.monthly_limit;
            footer.push("Extra usage (overage)");
            if (typeof limit === "number" && limit > 0) {
                const util = Math.round(extra.utilization ?? (used / limit) * 100);
                const remain = Math.max(0, 100 - util);
                footer.push(`${createProgressBar(remain, 26, ansi)} ${remain}% remaining`);
                footer.push(`Used: ${used}/${limit} ${cur}`);
            }
            else {
                footer.push(`Used: ${used} ${cur}`);
            }
        }
        if (!windows.length) {
            footer.push("(No rolling-window limits found \u2014 may be API-key plan or unlimited)");
        }
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
// ============================================================
// Google Antigravity
//
// Preferred source: the local Antigravity Tools management API. It exposes
// richer 5-hour + weekly quota groups and proxy token statistics without
// requiring this plugin to refresh Google OAuth tokens itself. If the service
// is unavailable (or not configured), the existing auth-plugin live/cached
// path below remains the fallback.
// ============================================================
const GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const GOOGLE_QUOTA_GROUPS = [
    { key: "gemini-pro", display: "Gemini Pro" },
    { key: "gemini-flash", display: "Gemini Flash" },
    { key: "claude", display: "Claude" },
    { key: "gpt-oss", display: "GPT-OSS" },
];
// Classify a retrieveUserQuota bucket modelId into a user-facing family.
// Internal "chat_*"/"tab_*" helper models carry no user quota and are dropped.
// Order matters: Claude and GPT-OSS are matched before the Gemini families.
function classifyAntigravityGroup(modelId) {
    const m = modelId.toLowerCase();
    if (m.startsWith("chat_") || m.startsWith("tab_"))
        return null;
    if (m.includes("claude"))
        return "claude";
    if (m.includes("gpt-oss") || m.includes("gpt"))
        return "gpt-oss";
    if (!m.includes("gemini"))
        return null;
    return m.includes("flash") ? "gemini-flash" : "gemini-pro";
}
// Fold per-model quota buckets into family buckets using the conservative
// (minimum) remaining fraction and the earliest reset time, matching the auth
// plugin's aggregateQuota so the live path agrees with the cached snapshot.
function aggregateAntigravityQuota(buckets) {
    const groups = {};
    for (const bucket of buckets ?? []) {
        const modelId = bucket.modelId;
        if (!modelId)
            continue;
        const group = classifyAntigravityGroup(modelId);
        if (!group)
            continue;
        const rawFraction = bucket.remainingFraction;
        const fraction = typeof rawFraction === "number" && Number.isFinite(rawFraction)
            ? Math.max(0, Math.min(1, rawFraction))
            : undefined;
        const resetTime = bucket.resetTime;
        const existing = groups[group];
        const nextRemaining = fraction === undefined
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
async function refreshGoogleAccessToken(refreshToken) {
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
    if (!res.ok)
        throw new Error(`Google token refresh failed (${res.status})`);
    const data = (await res.json());
    return data.access_token;
}
// The Cloud Code ClientMetadata.platform field is a typed enum; the string
// "MACOS"/"WINDOWS" used elsewhere is rejected with HTTP 400 here, which is why
// project resolution silently failed and quota fell back to the generic catalog.
function googlePlatformEnum() {
    if (process.platform === "win32")
        return "WINDOWS_AMD64";
    if (process.platform === "darwin") {
        return process.arch === "arm64" ? "DARWIN_ARM64" : "DARWIN_AMD64";
    }
    return process.arch === "arm64" ? "LINUX_ARM64" : "LINUX_AMD64";
}
// Resolve the account's managed cloudaicompanion project via loadCodeAssist.
// retrieveUserQuota returns the generic (always-100%) catalog without it.
async function resolveGoogleProject(accessToken, fallback) {
    const platform = googlePlatformEnum();
    try {
        const res = await fetchTimeout("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
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
        });
        if (!res.ok)
            return fallback;
        const data = (await res.json());
        const proj = typeof data.cloudaicompanionProject === "string"
            ? data.cloudaicompanionProject
            : data.cloudaicompanionProject?.id;
        return proj || fallback;
    }
    catch {
        return fallback;
    }
}
async function fetchGoogleLiveQuota(accessToken, projectId, userAgent) {
    try {
        const res = await fetchTimeout("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
                "User-Agent": userAgent,
            },
            body: JSON.stringify(projectId ? { project: projectId } : {}),
        });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
}
function formatCachedAgeMinutes(updatedAt) {
    if (!updatedAt)
        return "";
    const ageMs = Date.now() - updatedAt;
    const mins = Math.round(ageMs / 60_000);
    if (mins < 1)
        return " (just updated)";
    if (mins === 1)
        return " (1 min ago)";
    return ` (${mins} min ago)`;
}
const ANTIGRAVITY_TOOLS_GUI_CONFIG = join(homedir(), ".antigravity_tools", "gui_config.json");
function loadAntigravityToolsGuiConfig() {
    try {
        return JSON.parse(readFileSync(ANTIGRAVITY_TOOLS_GUI_CONFIG, "utf-8"));
    }
    catch {
        return null;
    }
}
function normalizeAntigravityToolsBaseUrl(raw) {
    const value = raw.trim();
    if (!value)
        return null;
    try {
        const url = new URL(value.includes("://") ? value : `http://${value}`);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return null;
        url.search = "";
        url.hash = "";
        let pathname = url.pathname.replace(/\/+$/, "");
        while (/\/(?:v1|api)$/i.test(pathname))
            pathname = pathname.replace(/\/(?:v1|api)$/i, "");
        return `${url.origin}${pathname && pathname !== "/" ? pathname : ""}`;
    }
    catch {
        return null;
    }
}
function isLoopbackBaseUrl(baseUrl) {
    try {
        const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
        if (host === "localhost" || host === "::1")
            return true;
        const octets = host.split(".");
        return (octets.length === 4 &&
            octets[0] === "127" &&
            octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255));
    }
    catch {
        return false;
    }
}
function resolveAntigravityToolsSettings(cfg) {
    const configured = cfg.antigravityTools;
    if (configured?.enabled === false)
        return null;
    const gui = loadAntigravityToolsGuiConfig();
    const envBase = process.env.ANTIGRAVITY_TOOLS_BASE_URL;
    const envApiKey = process.env.ANTIGRAVITY_TOOLS_API_KEY;
    const envAdminPassword = process.env.ANTIGRAVITY_TOOLS_ADMIN_PASSWORD;
    const envUsageHours = process.env.ANTIGRAVITY_TOOLS_USAGE_HOURS;
    const explicitlyRequested = Boolean(configured || envBase || envApiKey || envAdminPassword || envUsageHours);
    // The persisted `proxy.enabled` flag can be false while an auto-started
    // service is actively listening, so config-file presence is the reliable
    // zero-config discovery signal. A stopped service fails fast and falls back.
    if (!explicitlyRequested && !gui)
        return null;
    const port = typeof gui?.proxy?.port === "number" && gui.proxy.port > 0 && gui.proxy.port <= 65_535
        ? Math.floor(gui.proxy.port)
        : 8045;
    const baseUrl = normalizeAntigravityToolsBaseUrl(envBase ?? configured?.baseUrl ?? `http://127.0.0.1:${port}`);
    if (!baseUrl)
        return null;
    const credentials = [];
    const addCredential = (value) => {
        if (!value || credentials.includes(value))
            return;
        credentials.push(value);
    };
    // Management routes prefer a separate admin password when one is set.
    // Only auto-send credentials from the local GUI config to loopback URLs;
    // explicit remote instances must provide their own env/config credential.
    addCredential(envAdminPassword);
    addCredential(configured?.adminPassword);
    if (isLoopbackBaseUrl(baseUrl))
        addCredential(gui?.proxy?.admin_password);
    addCredential(envApiKey);
    addCredential(configured?.apiKey);
    if (isLoopbackBaseUrl(baseUrl))
        addCredential(gui?.proxy?.api_key);
    const configuredHours = Number(envUsageHours ?? configured?.usageHours ?? 168);
    const usageHours = Number.isFinite(configuredHours)
        ? Math.max(1, Math.min(24 * 365, Math.floor(configuredHours)))
        : 168;
    return {
        baseUrl,
        credentials,
        usageHours,
        includeUsage: configured?.includeUsage !== false,
    };
}
function antigravityToolsHeaders(credential) {
    const headers = {
        Accept: "application/json",
        "User-Agent": "OpenCode-MyStatus/3",
    };
    if (credential)
        headers.Authorization = `Bearer ${credential}`;
    return headers;
}
async function connectAntigravityTools(settings) {
    const candidates = settings.credentials.length
        ? settings.credentials
        : [undefined];
    let authRejected = false;
    for (const credential of candidates) {
        let res;
        try {
            res = await fetchTimeout(`${settings.baseUrl}/api/accounts`, { method: "GET", headers: antigravityToolsHeaders(credential) }, 4_000, 0);
        }
        catch (err) {
            throw new Error(`Antigravity Tools is unavailable at ${settings.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (res.status === 401 || res.status === 403) {
            authRejected = true;
            continue;
        }
        if (!res.ok)
            throw new Error(`Antigravity Tools accounts API error (${res.status})`);
        const accounts = (await res.json());
        if (!Array.isArray(accounts.accounts)) {
            throw new Error("Antigravity Tools accounts API returned an unexpected response");
        }
        return { settings, credential, accounts };
    }
    throw new Error(authRejected
        ? "Antigravity Tools management authentication failed; configure its admin password or API key"
        : "Antigravity Tools management API requires an admin password or API key");
}
async function fetchAntigravityToolsJson(client, path) {
    const res = await fetchTimeout(`${client.settings.baseUrl}${path}`, { method: "GET", headers: antigravityToolsHeaders(client.credential) }, 4_000, 0);
    if (!res.ok)
        throw new Error(`Antigravity Tools API error (${res.status}) for ${path}`);
    return (await res.json());
}
async function fetchAntigravityToolsOptional(client, paths) {
    for (const path of paths) {
        try {
            return await fetchAntigravityToolsJson(client, path);
        }
        catch {
            // Newer /stats/token routes and their older aliases are both supported.
        }
    }
    return null;
}
function antigravityToolsPeriod(hours) {
    if (hours % (24 * 7) === 0)
        return `${hours / (24 * 7)}w`;
    if (hours % 24 === 0)
        return `${hours / 24}d`;
    return `${hours}h`;
}
function antigravityToolsGroupLabel(raw) {
    const label = (raw ?? "Quota").replace(/\s+models?$/i, "").trim();
    return label.replace(/\s+and\s+/gi, " & ");
}
function antigravityToolsBucketLabel(bucket) {
    const window = (bucket.window ?? "").toLowerCase();
    if (window === "5h" || window === "five-hour")
        return "5-hour";
    if (window === "weekly" || window === "week")
        return "Weekly";
    if (window === "daily" || window === "day")
        return "Daily";
    return (bucket.display_name ?? bucket.window ?? "Limit")
        .replace(/\s+limit$/i, "")
        .replace(/five[ -]hour/i, "5-hour");
}
function antigravityToolsQuotaWindows(account) {
    const quota = account.quota;
    if (!quota)
        return [];
    const email = account.email ?? account.name ?? account.id ?? "unknown";
    const windows = [];
    for (const group of quota.quota_groups ?? []) {
        const groupLabel = antigravityToolsGroupLabel(group.display_name);
        const buckets = [...(group.buckets ?? [])].sort((a, b) => {
            const rank = (w) => {
                const value = (w ?? "").toLowerCase();
                if (value === "5h" || value.includes("hour"))
                    return 0;
                if (value === "daily")
                    return 1;
                if (value === "weekly")
                    return 2;
                return 3;
            };
            return rank(a.window) - rank(b.window);
        });
        for (const bucket of buckets) {
            const fraction = bucket.remaining_fraction;
            if (typeof fraction !== "number" || !Number.isFinite(fraction))
                continue;
            const bucketLabel = antigravityToolsBucketLabel(bucket);
            const label = `${groupLabel} · ${bucketLabel}`;
            windows.push({
                label,
                trendKey: `${label} · ${email}`,
                remaining: Math.round(Math.max(0, Math.min(1, fraction)) * 100),
                resetAt: bucket.reset_time || undefined,
            });
        }
    }
    if (windows.length > 0)
        return windows;
    // Antigravity Tools versions before quota_groups exposed only per-model
    // percentages. Collapse those into stable model families as a compatibility
    // fallback, mirroring the direct Google source below.
    const grouped = {};
    for (const model of quota.models ?? []) {
        if (!model.name || typeof model.percentage !== "number")
            continue;
        const group = classifyAntigravityGroup(model.name);
        if (!group)
            continue;
        const remainingFraction = Math.max(0, Math.min(100, model.percentage)) / 100;
        const existing = grouped[group];
        const resetTs = model.reset_time ? Date.parse(model.reset_time) : Number.NaN;
        const existingResetTs = existing?.resetTime ? Date.parse(existing.resetTime) : Number.NaN;
        grouped[group] = {
            remainingFraction: existing?.remainingFraction === undefined
                ? remainingFraction
                : Math.min(existing.remainingFraction, remainingFraction),
            resetTime: Number.isFinite(resetTs) && (!Number.isFinite(existingResetTs) || resetTs < existingResetTs)
                ? model.reset_time
                : existing?.resetTime,
            modelCount: (existing?.modelCount ?? 0) + 1,
        };
    }
    for (const group of GOOGLE_QUOTA_GROUPS) {
        const info = grouped[group.key];
        if (info?.remainingFraction === undefined)
            continue;
        windows.push({
            label: group.display,
            trendKey: `${group.display} · ${email}`,
            remaining: Math.round(info.remainingFraction * 100),
            resetAt: info.resetTime,
        });
    }
    return windows;
}
function antigravityToolsUpdatedText(lastUpdated) {
    if (typeof lastUpdated !== "number" || !Number.isFinite(lastUpdated) || lastUpdated <= 0)
        return null;
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000 - lastUpdated));
    return ageSec < 60 ? "updated now" : `updated ${formatDuration(ageSec)} ago`;
}
function antigravityToolsStatusWarning(account) {
    if (account.validation_blocked) {
        return `\u26a0\ufe0f Validation blocked${account.validation_blocked_reason ? `: ${account.validation_blocked_reason}` : ""}`;
    }
    if (account.proxy_disabled) {
        return `\u26a0\ufe0f Proxy disabled${account.proxy_disabled_reason ? `: ${account.proxy_disabled_reason}` : ""}`;
    }
    if (account.quota?.is_forbidden)
        return "\u26a0\ufe0f Account quota access is forbidden";
    return undefined;
}
async function queryAntigravityTools(cfg) {
    const settings = resolveAntigravityToolsSettings(cfg);
    if (!settings)
        return null;
    let client;
    try {
        client = await connectAntigravityTools(settings);
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    const hoursQuery = `?hours=${settings.usageHours}`;
    const [health, summary, accountStats, modelStats] = await Promise.all([
        fetchAntigravityToolsOptional(client, ["/health"]),
        settings.includeUsage
            ? fetchAntigravityToolsOptional(client, [
                `/api/stats/token/summary${hoursQuery}`,
                `/api/stats/summary${hoursQuery}`,
            ])
            : Promise.resolve(null),
        settings.includeUsage
            ? fetchAntigravityToolsOptional(client, [
                `/api/stats/token/by-account${hoursQuery}`,
                `/api/stats/accounts${hoursQuery}`,
            ])
            : Promise.resolve(null),
        settings.includeUsage
            ? fetchAntigravityToolsOptional(client, [
                `/api/stats/token/by-model${hoursQuery}`,
                `/api/stats/models${hoursQuery}`,
            ])
            : Promise.resolve(null),
    ]);
    const excluded = new Set((cfg.google?.excludeEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean));
    const accounts = (client.accounts.accounts ?? []).filter((account) => {
        const email = (account.email ?? "").trim().toLowerCase();
        return Boolean(email) && account.disabled !== true && !excluded.has(email);
    });
    const statsByEmail = new Map((Array.isArray(accountStats) ? accountStats : [])
        .filter((stats) => stats.account_email)
        .map((stats) => [stats.account_email.trim().toLowerCase(), stats]));
    const period = antigravityToolsPeriod(settings.usageHours);
    const cards = [];
    for (const account of accounts) {
        const accountWindows = antigravityToolsQuotaWindows(account);
        const header = [
            `Source: Antigravity Tools${health?.version ? ` ${health.version}` : ""}`,
        ];
        if (account.quota?.subscription_tier) {
            header.push(`Plan: ${account.quota.subscription_tier}`);
        }
        header.push(`Status: enabled${account.is_current ? " · current" : ""}`);
        const updated = antigravityToolsUpdatedText(account.quota?.last_updated);
        if (updated)
            header.push(`Quota: ${updated}`);
        const warning = antigravityToolsStatusWarning(account);
        const footer = [];
        if (warning && accountWindows.length)
            accountWindows[0].warn = warning;
        else if (warning)
            footer.push(warning);
        const usage = statsByEmail.get((account.email ?? "").trim().toLowerCase());
        if (usage) {
            header.push(`Proxy ${period}: ${humanCount(usage.total_tokens ?? 0)} tokens · ${(usage.request_count ?? 0).toLocaleString()} requests`);
        }
        if (!accountWindows.length)
            footer.push("No quota data available for this account.");
        cards.push({
            subtitle: account.email ?? account.name ?? account.id ?? "unknown",
            header,
            windows: accountWindows.length ? accountWindows : undefined,
            footer: footer.length ? footer : undefined,
        });
    }
    if (!cards.length) {
        return {
            success: false,
            error: "Antigravity Tools returned no enabled accounts",
        };
    }
    const aggregateFooter = [];
    if (summary) {
        aggregateFooter.push(`All proxy accounts (${period}): ${humanCount(summary.total_tokens ?? 0)} tokens · ${(summary.total_requests ?? 0).toLocaleString()} requests`, `Input / output: ${humanCount(summary.total_input_tokens ?? 0)} / ${humanCount(summary.total_output_tokens ?? 0)}`, `Cache reads: ${humanCount(summary.total_cached_tokens ?? 0)} tokens`);
    }
    const topModels = (Array.isArray(modelStats) ? modelStats : [])
        .filter((stats) => stats.model && (stats.total_tokens ?? 0) > 0)
        .sort((a, b) => (b.total_tokens ?? 0) - (a.total_tokens ?? 0))
        .slice(0, 3);
    if (topModels.length) {
        aggregateFooter.push(`Top proxy models (${period}):`);
        for (const model of topModels) {
            aggregateFooter.push(`  ${model.model}: ${humanCount(model.total_tokens ?? 0)} tokens · ${(model.request_count ?? 0).toLocaleString()} requests`);
        }
    }
    if (aggregateFooter.length) {
        const aggregateIndex = accounts.findIndex((account) => account.is_current);
        const aggregateCard = cards[aggregateIndex >= 0 ? aggregateIndex : 0];
        aggregateCard.footer = [...(aggregateCard.footer ?? []), ...aggregateFooter];
    }
    return {
        success: true,
        cards,
    };
}
async function queryGoogle(ansi = false) {
    const cfg = loadConfig();
    const toolsResult = await queryAntigravityTools(cfg);
    if (toolsResult?.success && toolsResult.cards?.length)
        return toolsResult;
    const allAccounts = await loadAntigravityAccountsMerged(cfg);
    if (allAccounts.length === 0) {
        return {
            success: false,
            error: toolsResult?.error
                ? `Antigravity Tools: ${toolsResult.error}\nFallback: antigravity-accounts.json not found in any opencode profile.`
                : "antigravity-accounts.json not found in any opencode profile.\n" +
                    "Install the opencode-antigravity-auth plugin and sign in to enable Google quota.",
        };
    }
    try {
        const accounts = allAccounts.filter((a) => a.email && a.enabled !== false);
        if (!accounts.length)
            return { success: true, output: "No enabled Google accounts found." };
        const cards = [];
        for (const account of accounts) {
            const ua = account.fingerprint?.userAgent ?? "antigravity/1.23.2 windows/amd64";
            const windows = [];
            let cachedNote;
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
                                trendKey: `${group.display} · ${account.email}`,
                                remaining: Math.round(info.remainingFraction * 100),
                                resetAt: info.resetTime,
                            });
                        }
                    }
                    usedLive = windows.length > 0;
                }
            }
            catch {
            }
            if (!usedLive && account.cachedQuota) {
                cachedNote = `cached${formatCachedAgeMinutes(account.cachedQuotaUpdatedAt)}`;
                for (const group of GOOGLE_QUOTA_GROUPS) {
                    const info = account.cachedQuota[group.key];
                    if (info) {
                        windows.push({
                            label: group.display,
                            trendKey: `${group.display} · ${account.email}`,
                            remaining: Math.round(info.remainingFraction * 100),
                            resetAt: info.resetTime,
                        });
                    }
                }
            }
            cards.push({
                subtitle: account.email,
                note: cachedNote,
                windows: windows.length ? windows : undefined,
                footer: windows.length
                    ? undefined
                    : ["No quota data available for this account."],
            });
        }
        if (!cards.length) {
            return { success: true, output: "No quota data available for Google accounts." };
        }
        return { success: true, cards };
    }
    catch (err) {
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
// Request-based billing is retained only for accounts still served by the
// legacy premium-request endpoint.
const COPILOT_LEGACY_REQUEST_LIMITS = {
    free: 50,
    pro: 300,
    "pro+": 1500,
    business: 300,
    enterprise: 1000,
};
// Current individual-plan allowances. Organization-managed Business and
// Enterprise credits are pooled, so a user-level report cannot truthfully
// derive a remaining percentage for those plans.
const COPILOT_AI_CREDIT_LIMITS = {
    pro: 1500,
    "pro+": 7000,
    max: 20_000,
};
function getCopilotPATPath() {
    return findReadable("copilot-quota-token.json", "config")
        ?? join(opencodeConfigDir(), "copilot-quota-token.json");
}
function readCopilotPAT() {
    try {
        const p = getCopilotPATPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const cfg = JSON.parse(raw);
        return cfg.token && cfg.username && cfg.tier ? cfg : null;
    }
    catch {
        return null;
    }
}
function copilotWindow(label, q, resetAt) {
    if (q.unlimited) {
        return { label, remaining: 100, resetAt, suffix: "Unlimited", detail: ["Used: Unlimited"] };
    }
    const entitlement = typeof q.entitlement === "number" && Number.isFinite(q.entitlement)
        ? q.entitlement
        : undefined;
    const remaining = typeof q.remaining === "number" && Number.isFinite(q.remaining) ? q.remaining : undefined;
    const pct = typeof q.percent_remaining === "number" && Number.isFinite(q.percent_remaining)
        ? q.percent_remaining
        : entitlement && remaining !== undefined
            ? (remaining / entitlement) * 100
            : 0;
    const detail = entitlement !== undefined && remaining !== undefined
        ? [`Used: ${Math.max(0, entitlement - remaining)} / ${entitlement}`]
        : undefined;
    return { label, remaining: Math.round(clampPercent(pct)), resetAt, detail };
}
function normalizeCopilotTier(tier) {
    const normalized = tier.trim().toLowerCase().replace(/^copilot[\s_-]*/, "");
    if (/^pro(?:\+|[\s_-]?plus)$/.test(normalized))
        return "pro+";
    return normalized;
}
function nextCalendarMonthUtcIso() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
function copilotBillingPeriod(period) {
    if (!period || typeof period.year !== "number")
        return null;
    let value = String(period.year);
    if (typeof period.month === "number")
        value += `-${String(period.month).padStart(2, "0")}`;
    if (typeof period.day === "number")
        value += `-${String(period.day).padStart(2, "0")}`;
    return value;
}
function formatCopilotQuantity(value) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function copilotBillingModelSummary(items) {
    const byModel = new Map();
    for (const item of items) {
        if (!item.model || typeof item.grossQuantity !== "number")
            continue;
        byModel.set(item.model, (byModel.get(item.model) ?? 0) + item.grossQuantity);
    }
    const sorted = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
    if (!sorted.length)
        return null;
    const shown = sorted.slice(0, 4).map(([model, quantity]) => `${model} ${formatCopilotQuantity(quantity)}`);
    if (sorted.length > shown.length)
        shown.push(`+${sorted.length - shown.length} more`);
    return `By model: ${shown.join(" · ")}`;
}
function copilotResetCountdown(date) {
    const diffMs = new Date(date).getTime() - Date.now();
    if (diffMs <= 0)
        return "resets soon";
    const days = Math.floor(diffMs / 86_400_000);
    const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}
async function queryCopilotViaOAuth(auth) {
    const oauthToken = auth.refresh || auth.access;
    if (!oauthToken)
        throw new Error("No OAuth token in Copilot auth data");
    const direct = await fetchTimeout("https://api.github.com/copilot_internal/user", {
        headers: {
            Accept: "application/json",
            Authorization: `token ${oauthToken}`,
            ...COPILOT_HEADERS,
        },
    });
    if (direct.ok)
        return direct.text();
    const exchRes = await fetchTimeout("https://api.github.com/copilot_internal/v2/token", {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${oauthToken}`,
            ...COPILOT_HEADERS,
        },
    });
    if (exchRes.ok) {
        const exchData = (await exchRes.json());
        const afterExch = await fetchTimeout("https://api.github.com/copilot_internal/user", {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${exchData.token}`,
                ...COPILOT_HEADERS,
            },
        });
        if (afterExch.ok)
            return afterExch.text();
        throw new Error(`Copilot API error after token exchange (${afterExch.status})`);
    }
    throw new Error("\u26a0\ufe0f GitHub Copilot quota unavailable via OAuth.\n" +
        "OpenCode's OAuth integration doesn't expose the quota API scope.\n\n" +
        "Solution: create a fine-grained PAT with Plan \u2192 Read-only permission and save to:\n" +
        `  ${getCopilotPATPath()}\n` +
        '  {"token": "github_pat_...", "username": "YourUsername", "tier": "pro"}');
}
async function queryCopilotViaPAT(pat) {
    const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${pat.token}`,
        "X-GitHub-Api-Version": "2026-03-10",
    };
    const base = `https://api.github.com/users/${encodeURIComponent(pat.username)}/settings/billing`;
    const [aiCreditRes, premiumRequestRes] = await Promise.all([
        fetchTimeout(`${base}/ai_credit/usage`, { headers }),
        fetchTimeout(`${base}/premium_request/usage`, { headers }),
    ]);
    const parse = async (response) => {
        if (!response.ok)
            return null;
        try {
            return (await response.json());
        }
        catch {
            return null;
        }
    };
    const [aiBilling, premiumBilling] = await Promise.all([
        parse(aiCreditRes),
        parse(premiumRequestRes),
    ]);
    const tier = normalizeCopilotTier(pat.tier);
    if (aiBilling) {
        const items = aiBilling.usageItems ?? [];
        const limit = COPILOT_AI_CREDIT_LIMITS[tier];
        if (items.length > 0 || limit !== undefined) {
            const used = items.reduce((sum, item) => sum + (typeof item.grossQuantity === "number" && Number.isFinite(item.grossQuantity)
                ? item.grossQuantity
                : 0), 0);
            const windows = [];
            const footer = [];
            if (limit !== undefined) {
                windows.push({
                    label: "Monthly AI credits",
                    remaining: Math.round(clampPercent(((limit - used) / limit) * 100)),
                    resetAt: nextCalendarMonthUtcIso(),
                    detail: [`Used: ${formatCopilotQuantity(used)} / ${limit.toLocaleString()} credits`],
                });
            }
            else {
                footer.push(`AI credits used: ${formatCopilotQuantity(used)}`);
                if (tier === "business" || tier === "enterprise") {
                    footer.push("Included credits are organization-pooled; no per-user remainder is reported.");
                }
            }
            const modelSummary = copilotBillingModelSummary(items);
            if (modelSummary)
                footer.push(modelSummary);
            const netAmount = items.reduce((sum, item) => sum + (typeof item.netAmount === "number" && Number.isFinite(item.netAmount)
                ? item.netAmount
                : 0), 0);
            if (netAmount > 0)
                footer.push(`Net metered amount: $${netAmount.toFixed(2)}`);
            const period = copilotBillingPeriod(aiBilling.timePeriod);
            if (period)
                footer.push(`Billing period: ${period}`);
            return {
                success: true,
                cards: [{
                        header: [
                            `Account:        GitHub Copilot (@${aiBilling.user ?? pat.username})`,
                            `Plan:           ${pat.tier}`,
                        ],
                        windows: windows.length ? windows : undefined,
                        footer: footer.length ? footer : undefined,
                    }],
            };
        }
    }
    // Accounts still on request-based billing continue to expose the legacy
    // report. Only use its plan caps with that endpoint; never mix request caps
    // with the newer AI-credit ledger.
    if (premiumBilling) {
        const items = (premiumBilling.usageItems ?? []).filter((item) => /premium|request/i.test(`${item.product ?? ""} ${item.sku ?? ""} ${item.unitType ?? ""}`));
        const limit = COPILOT_LEGACY_REQUEST_LIMITS[tier];
        if (items.length > 0 || (limit !== undefined && !aiBilling)) {
            const used = items.reduce((sum, item) => sum + (typeof item.grossQuantity === "number" && Number.isFinite(item.grossQuantity)
                ? item.grossQuantity
                : 0), 0);
            const windows = [];
            const footer = [];
            if (limit !== undefined) {
                windows.push({
                    label: "Monthly premium requests (legacy)",
                    remaining: Math.round(clampPercent(((limit - used) / limit) * 100)),
                    detail: [`Used: ${formatCopilotQuantity(used)} / ${limit.toLocaleString()}`],
                });
            }
            else {
                footer.push(`Premium requests used: ${formatCopilotQuantity(used)}`);
            }
            const modelSummary = copilotBillingModelSummary(items);
            if (modelSummary)
                footer.push(modelSummary);
            const period = copilotBillingPeriod(premiumBilling.timePeriod);
            if (period)
                footer.push(`Billing period: ${period}`);
            return {
                success: true,
                cards: [{
                        header: [
                            `Account:        GitHub Copilot (@${premiumBilling.user ?? pat.username})`,
                            `Plan:           ${pat.tier} (request-based billing)`,
                        ],
                        windows: windows.length ? windows : undefined,
                        footer: footer.length ? footer : undefined,
                    }],
            };
        }
    }
    if (!aiCreditRes.ok && !premiumRequestRes.ok) {
        throw new Error(`GitHub billing APIs unavailable (AI credits ${aiCreditRes.status}, premium requests ${premiumRequestRes.status})`);
    }
    return null;
}
async function queryCopilot(auth, ansi = false) {
    const pat = readCopilotPAT();
    let patError = null;
    if (pat) {
        try {
            const result = await queryCopilotViaPAT(pat);
            if (result)
                return result;
        }
        catch (err) {
            patError = err instanceof Error ? err.message : String(err);
        }
    }
    if (!auth || auth.type !== "oauth" || (!auth.refresh && !auth.access)) {
        return patError ? { success: false, error: patError } : null;
    }
    try {
        const raw = await queryCopilotViaOAuth(auth);
        const data = JSON.parse(raw);
        const snaps = data.quota_snapshots ?? {};
        const labels = {
            premium_interactions: "Premium",
            chat: "Chat",
            completions: "Completions",
        };
        const order = { premium_interactions: 0, chat: 1, completions: 2 };
        const resetAt = Number.isFinite(Date.parse(data.quota_reset_date))
            ? data.quota_reset_date
            : undefined;
        const windows = Object.entries(snaps)
            .filter((entry) => Boolean(entry[1]))
            .sort(([a], [b]) => (order[a] ?? 99) - (order[b] ?? 99) || a.localeCompare(b))
            .map(([key, snapshot]) => {
            const label = labels[key] ?? key
                .replace(/[_-]+/g, " ")
                .replace(/\b\w/g, (character) => character.toUpperCase());
            return copilotWindow(label, snapshot, resetAt);
        });
        if (!windows.length)
            throw new Error("Copilot quota API returned no quota snapshots");
        const footer = [];
        const premium = snaps.premium_interactions;
        if (premium?.overage_count)
            footer.push(`Overage: ${premium.overage_count} requests`, "");
        footer.push(`Resets in: ${copilotResetCountdown(data.quota_reset_date)}`);
        return {
            success: true,
            cards: [
                { header: [`Account:        GitHub Copilot (${data.copilot_plan})`], windows, footer },
            ],
        };
    }
    catch (err) {
        const oauthError = err instanceof Error ? err.message : String(err);
        return { success: false, error: patError ? `${patError}\n${oauthError}` : oauthError };
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
const OPENCODE_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
const ZEN_UNITS_PER_DOLLAR = 1e8;
const GO_SCRAPE_PATTERNS = [
    {
        key: "rolling",
        label: "5h (rolling)",
        pctFirst: new RegExp(String.raw `rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*\}`),
        resetFirst: new RegExp(String.raw `rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*\}`),
    },
    {
        key: "weekly",
        label: "Weekly",
        pctFirst: new RegExp(String.raw `weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*\}`),
        resetFirst: new RegExp(String.raw `weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*\}`),
    },
    {
        key: "monthly",
        label: "Monthly",
        pctFirst: new RegExp(String.raw `monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*\}`),
        resetFirst: new RegExp(String.raw `monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:(-?\d+(?:\.\d+)?)[^}]*usagePercent:(-?\d+(?:\.\d+)?)[^}]*\}`),
    },
];
function parseGoWindow(html, pattern) {
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
function parseZenBillingHtml(html) {
    const balance = html.match(/balance:(\d+)/);
    const monthlyUsage = html.match(/monthlyUsage:(\d+)/);
    const monthlyLimit = html.match(/monthlyLimit:(\d+|null)/);
    const reloadAmount = html.match(/reloadAmount:(\d+)/);
    const reloadTrigger = html.match(/reloadTrigger:(\d+)/);
    const payType = html.match(/paymentMethodType:"([^"]+)"/);
    const payLast4 = html.match(/paymentMethodLast4:"([^"]*)"/);
    if (!balance || !monthlyUsage || !reloadAmount || !reloadTrigger)
        return null;
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
function parseZenPayments(html) {
    const payments = [];
    const re = /id:"pay_[^"]+",[^]*?amount:(\d+),[^]*?timeCreated:\$R\[\d+\]=new Date\("([^"]+)"\)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        payments.push({
            amountUsd: Number(m[1]) / ZEN_UNITS_PER_DOLLAR,
            timeCreated: m[2],
        });
    }
    return payments;
}
function parseZenUsageByModel(html) {
    const modelMap = new Map();
    const re = /model:"([^"]+)"[^}]*cost:(\d+)/g;
    let m;
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
function zenPaymentLabel(type, last4) {
    if (!type)
        return "unknown";
    const labels = { link: "Stripe Link", card: "Card", bank_account: "Bank" };
    const name = labels[type] ?? type;
    return last4 ? `${name} \u00b7\u00b7\u00b7${last4}` : name;
}
function resolveOpenCodeGoConfigs() {
    const jsonPath = findReadable("opencode-go.json", "config")
        ?? join(opencodeConfigDir(), "opencode-go.json");
    if (existsSync(jsonPath)) {
        try {
            const raw = readFileSync(jsonPath, "utf-8");
            const cfg = JSON.parse(raw);
            if (Array.isArray(cfg.accounts) && cfg.accounts.length > 0) {
                return cfg.accounts
                    .filter((a) => typeof a?.workspaceId === "string" && typeof a?.authCookie === "string")
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
        }
        catch { }
    }
    const envWs = process.env.OPENCODE_GO_WORKSPACE_ID;
    const envCookie = process.env.OPENCODE_GO_AUTH_COOKIE;
    if (envWs && envCookie)
        return [{ workspaceId: envWs, authCookie: envCookie }];
    return [];
}
async function probeOpenCodeGoApiKey(apiKey) {
    if (!apiKey)
        return null;
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
        const data = (await res.json());
        const models = (data.data ?? []).map((model) => model.id).filter(Boolean);
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
    }
    catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
async function queryOpenCodeGoZenSingle(config, ansi = false) {
    const label = config.name || config.id || "OpenCode";
    const headers = {
        "User-Agent": OPENCODE_USER_AGENT,
        Accept: "text/html",
        Cookie: `auth=${config.authCookie}`,
    };
    try {
        const base = OPENCODE_DASHBOARD_PREFIX + encodeURIComponent(config.workspaceId);
        const [goRes, billingRes, usageRes] = await Promise.all([
            fetchTimeout(base + OPENCODE_GO_SUFFIX, { headers }),
            fetchTimeout(base + OPENCODE_ZEN_BILLING_SUFFIX, { headers }),
            fetchTimeout(base + OPENCODE_ZEN_USAGE_SUFFIX, { headers }),
        ]);
        const windows = [];
        // Go quota windows
        if (goRes.ok) {
            const goHtml = await goRes.text();
            for (const pattern of GO_SCRAPE_PATTERNS) {
                const data = parseGoWindow(goHtml, pattern);
                if (!data)
                    continue;
                windows.push({
                    label: pattern.label,
                    remaining: Math.round(100 - Math.max(0, data.usagePercent)),
                    resetInSec: Math.max(0, data.resetInSec),
                });
            }
        }
        // Zen balance / spend footer
        const footer = [];
        let billing = null;
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
            }
            else {
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
    }
    catch (err) {
        return {
            success: false,
            error: `${label}: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
async function queryOpenCodeGoZen(auth, ansi = false) {
    const configs = resolveOpenCodeGoConfigs();
    if (configs.length === 0) {
        return probeOpenCodeGoApiKey(auth?.key);
    }
    const results = await Promise.all(configs.map((c) => queryOpenCodeGoZenSingle(c, ansi)));
    const cards = [];
    const failures = [];
    for (const r of results) {
        if (r.success && r.cards?.length)
            cards.push(...r.cards);
        else if (r.error)
            failures.push(r.error);
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
function formatPoeTimestamp(ts) {
    const iso = epochToIso(ts);
    return iso ? formatResetAt(iso) : null;
}
function resolvePoeApiKey(auth) {
    if (auth?.access)
        return auth.access;
    if (auth?.refresh)
        return auth.refresh;
    if (auth?.key)
        return auth.key;
    if (process.env.POE_API_KEY)
        return process.env.POE_API_KEY;
    const jsonPath = findReadable("poe-api-key.json", "config")
        ?? join(opencodeConfigDir(), "poe-api-key.json");
    if (!existsSync(jsonPath))
        return null;
    try {
        const raw = readFileSync(jsonPath, "utf-8");
        const cfg = JSON.parse(raw);
        return cfg.apiKey ?? null;
    }
    catch {
        return null;
    }
}
async function queryPoe(auth, ansi = false) {
    const apiKey = resolvePoeApiKey(auth);
    if (!apiKey)
        return null;
    try {
        const headers = {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "User-Agent": "OpenCode-AllStatus/1.0",
        };
        const balanceRes = await fetchTimeout("https://api.poe.com/usage/current_balance", { headers });
        if (!balanceRes.ok) {
            const body = await balanceRes.text().catch(() => "");
            throw new Error(`Poe balance API error (${balanceRes.status}): ${body.slice(0, 200)}`);
        }
        const balance = (await balanceRes.json());
        const monthlyGrant = balance.next_monthly_grant_amount ?? 0;
        const usd = balance.total_balance_usd ? ` ($${balance.total_balance_usd} USD)` : "";
        const header = [`Balance:        ${balance.current_point_balance ?? "?"} pts${usd}`];
        const daily = formatPoeTimestamp(balance.next_daily_grant_time);
        if (daily)
            header.push(`Daily grant:    +${balance.next_daily_grant_amount ?? "?"} (Resets in: ${daily})`);
        const windows = [];
        if (monthlyGrant > 0 && typeof balance.plan_points_balance === "number") {
            const planPts = balance.plan_points_balance;
            const remainPct = Math.round(clampPercent((planPts / monthlyGrant) * 100));
            windows.push({
                label: "Monthly plan points",
                remaining: remainPct,
                detail: [`Plan points: ${planPts} / ${monthlyGrant}`],
                resetAt: epochToIso(balance.next_monthly_grant_time),
            });
        }
        const footer = [];
        if (monthlyGrant > 0 && typeof balance.plan_points_balance !== "number") {
            const monthly = formatPoeTimestamp(balance.next_monthly_grant_time);
            footer.push(`Next monthly grant: +${monthlyGrant}${monthly ? ` in ${monthly}` : ""}`);
        }
        if (typeof balance.addon_point_balance === "number" && balance.addon_point_balance > 0)
            footer.push(`Add-on points:  ${balance.addon_point_balance}`);
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
// ============================================================
// Z.AI Coding Plan
// ============================================================
const ZAI_BASE_URL = "https://api.z.ai";
const ZAI_UNIT_LABELS = {
    3: (n) => `${n}-hour rolling`,
    5: (n) => n >= 30 ? `${Math.round(n / 30)}-month` : "Monthly",
    6: (n) => "Weekly",
};
function zaiUnitLabel(unit, number_) {
    const fn = ZAI_UNIT_LABELS[unit];
    return fn ? fn(number_) : `Unit ${unit}`;
}
// Robustly convert Z.AI's nextResetTime (epoch s or ms; may be missing/NaN) to
// an ISO string. Returns undefined instead of throwing on bad input — this is
// the fix for the long-standing "Invalid Date" failure that killed the card.
function zaiResetAt(raw) {
    return epochToIso(raw);
}
function zaiLimitLabel(limit) {
    const base = zaiUnitLabel(limit.unit, limit.number);
    const type = (limit.type ?? "").trim();
    const evidence = `${type} ${(limit.usageDetails ?? []).map((detail) => detail.modelCode).join(" ")}`;
    if (/mcp|tool|web.?search|web.?reader/i.test(evidence)) {
        return limit.unit === 5 ? "Monthly MCP / tool calls" : `${base} — MCP / tool calls`;
    }
    if (!type || /^(time|quota|usage|token|prompt)(?:_limit)?$/i.test(type))
        return base;
    const scope = type
        .replace(/_limit$/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
    return `${base} — ${scope}`;
}
async function queryZai(auth, ansi = false) {
    if (!auth?.key)
        return null;
    try {
        const headers = {
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
        const quota = (await quotaRes.json());
        if (!quota.success || !quota.data?.limits) {
            throw new Error(`Z.AI quota API returned non-success: ${quota.msg}`);
        }
        let planLabel = `GLM Coding (${quota.data.level ?? "unknown"})`;
        let validityLine = "";
        let priceLine = "";
        let renewalLine = "";
        if (subRes.ok) {
            const subData = (await subRes.json());
            const active = (subData.data ?? []).find((s) => s.status === "VALID" && s.inCurrentPeriod);
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
        const header = [`Plan:           ${planLabel}`];
        if (priceLine)
            header.push(priceLine);
        if (validityLine)
            header.push(validityLine);
        if (renewalLine)
            header.push(renewalLine);
        const limits = [...quota.data.limits].sort((a, b) => {
            const weight = (u) => (u === 3 ? 1 : u === 6 ? 2 : u === 5 ? 3 : 99);
            return weight(a.unit) - weight(b.unit);
        });
        const windows = [];
        for (const limit of limits) {
            const used = typeof limit.usage === "number" && Number.isFinite(limit.usage)
                ? limit.usage
                : typeof limit.currentValue === "number" && Number.isFinite(limit.currentValue)
                    ? limit.currentValue
                    : undefined;
            const remaining = typeof limit.remaining === "number" && Number.isFinite(limit.remaining)
                ? limit.remaining
                : undefined;
            const usedPercent = typeof limit.percentage === "number" && Number.isFinite(limit.percentage)
                ? limit.percentage
                : used !== undefined && remaining !== undefined && used + remaining > 0
                    ? (used / (used + remaining)) * 100
                    : 0;
            const remain = Math.round(clampPercent(100 - usedPercent));
            const detail = [];
            if (remaining !== undefined && used !== undefined) {
                detail.push(`Used: ${used} / ${remaining + used}`);
            }
            const extra = [];
            if (limit.usageDetails?.length) {
                const withUsage = limit.usageDetails.filter((d) => d.usage > 0);
                if (withUsage.length) {
                    extra.push("  " + withUsage.map((d) => `${d.modelCode}: ${d.usage}`).join(", "));
                }
            }
            windows.push({
                label: zaiLimitLabel(limit),
                remaining: remain,
                resetAt: zaiResetAt(limit.nextResetTime),
                detail,
                extra,
            });
        }
        return { success: true, cards: [{ header, windows }] };
    }
    catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
// ============================================================
// xAI/Grok
//
// SuperGrok included usage is reported by cli-chat-proxy billing. A paid plan
// can spend the included pool across API, Build, Chat, Imagine, and Voice;
// extra usage credits apply after the included pool is exhausted.
//
// Two endpoint views:
//   GET /v1/billing?format=credits
//     Prefer: creditUsagePercent / weeklyUsagePercent, productUsage[],
//     currentPeriod, onDemand{Used,Cap}, prepaidBalance.
//     Unified-billing accounts may only return period metadata
//     (isUnifiedBillingUser) without a usage percent.
//   GET /v1/billing
//     Ledger: used + monthlyLimit (cents) and/or weeklyLimit, with
//     billingPeriodEnd. Used as the primary bar when credits omits percent,
//     otherwise as a separate monthly reference under the weekly bar.
//
// Two OAuth tokens can read the endpoint, both for the same account:
//   • opencode dev (~/.local/share/opencode/auth.json → "xai"/"xai-oauth",
//       referrer "opencode") — minted by the opencode-grok-auth plugin
//   • grok consumer (~/.grok/auth.json → "<issuer>::<client>".key,
//       referrer "grok-build") — minted by `grok login`
//
// We prefer the consumer token (auto-refreshes via refresh_token) and fall
// back to the opencode dev token.
// ============================================================
const GROK_BILLING_BASE = "https://cli-chat-proxy.grok.com/v1/billing";
const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_OAUTH_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
function grokConsumerAuthPath() {
    return join(homedir(), ".grok", "auth.json");
}
// Parse ~/.grok/auth.json. Returns null when the file is missing/malformed so
// callers can degrade gracefully (the file is written by `grok login`).
function loadGrokConsumerAuth() {
    try {
        const p = grokConsumerAuthPath();
        if (!existsSync(p))
            return null;
        const data = JSON.parse(readFileSync(p, "utf8"));
        for (const [storeKey, v] of Object.entries(data)) {
            if (v && typeof v === "object" && typeof v.key === "string") {
                const entry = v;
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
    }
    catch {
        return null;
    }
}
// Refresh an expired consumer token using its refresh_token and persist the new
// access/refresh/expiry back into ~/.grok/auth.json. Returns the fresh access
// token, or null on failure (caller falls back to the dev token).
async function refreshGrokConsumerToken(auth) {
    if (!auth.refreshToken)
        return null;
    try {
        const res = await fetchTimeout(XAI_OAUTH_TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: XAI_OAUTH_CLIENT_ID,
                refresh_token: auth.refreshToken,
            }),
        }, 10_000, 1);
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (!data.access_token)
            return null;
        // Best-effort write-back so the next run starts fresh. Never throw.
        try {
            const p = grokConsumerAuthPath();
            const file = JSON.parse(readFileSync(p, "utf8"));
            const entry = file[auth.storeKey];
            if (entry && typeof entry === "object") {
                entry.key = data.access_token;
                if (data.refresh_token)
                    entry.refresh_token = data.refresh_token;
                if (typeof data.expires_in === "number") {
                    entry.expires_at = new Date(Date.now() + data.expires_in * 1000).toISOString();
                }
                writeFileSync(p, JSON.stringify(file, null, 2));
            }
        }
        catch { }
        return data.access_token;
    }
    catch {
        return null;
    }
}
// Resolve a usable consumer access token: use the stored one if still valid,
// otherwise try to refresh. Returns null if there's no consumer auth at all.
async function resolveGrokConsumerToken() {
    const auth = loadGrokConsumerAuth();
    if (!auth)
        return null;
    const expired = typeof auth.expiresAt === "number" && auth.expiresAt <= Date.now() + 60_000;
    if (expired) {
        const refreshed = await refreshGrokConsumerToken(auth);
        return refreshed ?? auth.key; // try the stale token as a last resort
    }
    return auth.key;
}
// Format an ISO billing-period end as a compact "Mon D" reset hint (e.g.
// "Jul 1"), matching the Grok Build TUI / grok.com "Resets: …" line.
function formatGrokResetDate(iso) {
    if (!iso)
        return undefined;
    const t = Date.parse(iso);
    if (!Number.isFinite(t))
        return undefined;
    return new Date(t).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}
function grokPeriodLabel(type) {
    const normalized = type?.trim().toLowerCase() ?? "";
    if (/week/.test(normalized))
        return "Weekly";
    if (/month/.test(normalized))
        return "Monthly";
    if (/day/.test(normalized))
        return "Daily";
    if (!normalized)
        return "Weekly";
    return normalized
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
}
function formatGrokBillingCents(value) {
    return `$${(value / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}
function grokProductLabel(product) {
    const normalized = product.trim().toLowerCase().replace(/[_-]+/g, "");
    const labels = {
        api: "API",
        build: "Build",
        grokbuild: "Build",
        chat: "Chat",
        grokchat: "Chat",
        imagine: "Imagine",
        grokimagine: "Imagine",
        voice: "Voice",
        grokvoice: "Voice",
    };
    return labels[normalized] ?? product;
}
function grokCentsVal(value) {
    return typeof value?.val === "number" && Number.isFinite(value.val) ? value.val : undefined;
}
function grokFinitePercent(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate))
            return candidate;
    }
    return undefined;
}
function appendGrokExtraUsageDetail(detail, credits) {
    if (!credits)
        return;
    const onDemand = grokCentsVal(credits.onDemandUsed) ?? 0;
    const onDemandCap = grokCentsVal(credits.onDemandCap) ?? 0;
    if (onDemandCap > 0)
        detail.push(`Extra usage: ${onDemand}/${onDemandCap}`);
    const prepaid = grokCentsVal(credits.prepaidBalance) ?? 0;
    if (prepaid > 0)
        detail.push(`Extra usage credits: ${prepaid}`);
}
function appendGrokProductDetail(detail, credits) {
    const products = credits?.productUsage?.filter((p) => p && typeof p.product === "string");
    if (!products?.length)
        return;
    detail.push(`By product: ${products
        .map((p) => {
        const usage = typeof p.usagePercent === "number" && Number.isFinite(p.usagePercent) ? p.usagePercent : 0;
        return `${grokProductLabel(String(p.product))} ${usage.toFixed(2)}%`;
    })
        .join(" · ")}`);
}
async function queryXai(auth) {
    if (!auth || auth.type !== "oauth" || !auth.access)
        return null;
    // Prefer the consumer (grok-build) token — it auto-refreshes via
    // refresh_token, so it stays live across long sessions. Fall back to the
    // opencode dev token, which reads the same account's billing.
    const consumerToken = await resolveGrokConsumerToken();
    const hasConsumer = !!consumerToken;
    const devTokenExpired = !!(auth.expires && auth.expires < Date.now());
    if (devTokenExpired && !hasConsumer) {
        return { success: false, error: "xAI token expired. Use a Grok model in OpenCode to refresh." };
    }
    const creditsToken = consumerToken ?? auth.access;
    const authHeaders = { Authorization: `Bearer ${creditsToken}`, Accept: "application/json" };
    const header = [
        devTokenExpired ? "Auth:           consumer-only (dev token expired)" : "Auth:           valid",
    ];
    if (!devTokenExpired && typeof auth.expires === "number" && auth.expires > Date.now()) {
        header.push(`Token expires:  ${formatDuration(Math.floor((auth.expires - Date.now()) / 1000))}`);
    }
    // Fetch both billing views. Credits may omit usage percent for unified
    // billing users; the default ledger still carries used/limit dollars.
    let creditsCfg = null;
    let ledgerCfg = null;
    try {
        const r = await fetchTimeout(`${GROK_BILLING_BASE}?format=credits`, { headers: authHeaders });
        if (r.ok)
            creditsCfg = (await r.json()).config ?? {};
    }
    catch {
        // non-fatal
    }
    try {
        const billRes = await fetchTimeout(GROK_BILLING_BASE, { headers: authHeaders });
        if (billRes.ok)
            ledgerCfg = (await billRes.json()).config ?? {};
    }
    catch {
        // non-fatal
    }
    const windows = [];
    const planName = hasConsumer ? "SuperGrok" : "Grok";
    const periodLabel = grokPeriodLabel(creditsCfg?.currentPeriod?.type);
    const creditsUsedPct = grokFinitePercent(creditsCfg?.weeklyUsagePercent, creditsCfg?.creditUsagePercent);
    const used = grokCentsVal(ledgerCfg?.used);
    const weeklyLimit = grokCentsVal(ledgerCfg?.weeklyLimit);
    const monthlyLimit = grokCentsVal(ledgerCfg?.monthlyLimit);
    const hasWeeklyUnits = typeof used === "number" && typeof weeklyLimit === "number" && weeklyLimit > 0;
    const hasMonthlyDollars = typeof used === "number" && typeof monthlyLimit === "number" && monthlyLimit > 0;
    if (typeof creditsUsedPct === "number") {
        // Preferred path: provider-reported weekly (or period) percentage.
        const remain = Math.round(clampPercent(100 - creditsUsedPct));
        const resetAt = creditsCfg?.currentPeriod?.end ?? creditsCfg?.weeklyResetAt ?? creditsCfg?.billingPeriodEnd;
        const resetDate = formatGrokResetDate(resetAt);
        const detail = [
            `${periodLabel} usage: ${creditsUsedPct.toFixed(2)}% used${resetDate ? ` \u00b7 Resets ${resetDate}` : ""}`,
        ];
        appendGrokProductDetail(detail, creditsCfg);
        appendGrokExtraUsageDetail(detail, creditsCfg);
        if (hasWeeklyUnits) {
            detail.push(`Weekly included units: ${used.toLocaleString()} / ${weeklyLimit.toLocaleString()}`);
        }
        else if (hasMonthlyDollars) {
            detail.push(`Separate monthly billing: ${formatGrokBillingCents(used)} / ${formatGrokBillingCents(monthlyLimit)} (reference only)`);
            const monthlyReset = formatGrokResetDate(ledgerCfg?.billingPeriodEnd);
            if (monthlyReset)
                detail.push(`Monthly ledger resets: ${monthlyReset}`);
        }
        windows.push({
            label: `${periodLabel} ${planName} limit`,
            remaining: remain,
            resetAt,
            detail,
        });
    }
    else if (hasWeeklyUnits) {
        // Ledger reports weekly included units without a credits percent.
        const usedPct = (used / weeklyLimit) * 100;
        const remain = Math.round(clampPercent(100 - usedPct));
        const resetAt = creditsCfg?.currentPeriod?.end ??
            creditsCfg?.weeklyResetAt ??
            creditsCfg?.billingPeriodEnd ??
            ledgerCfg?.billingPeriodEnd;
        const resetDate = formatGrokResetDate(resetAt);
        const detail = [
            `Weekly included units: ${used.toLocaleString()} / ${weeklyLimit.toLocaleString()} (${usedPct.toFixed(2)}% used)${resetDate ? ` \u00b7 Resets ${resetDate}` : ""}`,
        ];
        appendGrokProductDetail(detail, creditsCfg);
        appendGrokExtraUsageDetail(detail, creditsCfg);
        if (hasMonthlyDollars) {
            detail.push(`Separate monthly billing: ${formatGrokBillingCents(used)} / ${formatGrokBillingCents(monthlyLimit)} (reference only)`);
            const monthlyReset = formatGrokResetDate(ledgerCfg?.billingPeriodEnd);
            if (monthlyReset)
                detail.push(`Monthly ledger resets: ${monthlyReset}`);
        }
        windows.push({
            label: `Weekly ${planName} limit`,
            remaining: remain,
            resetAt,
            detail,
        });
    }
    else if (hasMonthlyDollars) {
        // Credits omitted the usage percent (common for isUnifiedBillingUser).
        // The dollar ledger still has used/limit; period metadata on the credits
        // view remains the SuperGrok window (usually weekly). Label + reset follow
        // that window so the card doesn't say "Monthly" while counting down ~5 days.
        const usedPct = (used / monthlyLimit) * 100;
        const remain = Math.round(clampPercent(100 - usedPct));
        const periodResetAt = creditsCfg?.currentPeriod?.end ??
            creditsCfg?.weeklyResetAt ??
            creditsCfg?.billingPeriodEnd;
        const ledgerResetAt = ledgerCfg?.billingPeriodEnd;
        const resetAt = periodResetAt ?? ledgerResetAt;
        const labelPeriod = periodResetAt ? periodLabel : "Monthly";
        const resetDate = formatGrokResetDate(resetAt);
        const detail = [
            `Usage: ${formatGrokBillingCents(used)} / ${formatGrokBillingCents(monthlyLimit)} (${usedPct.toFixed(2)}% used)${resetDate ? ` \u00b7 Resets ${resetDate}` : ""}`,
        ];
        appendGrokProductDetail(detail, creditsCfg);
        appendGrokExtraUsageDetail(detail, creditsCfg);
        windows.push({
            label: `${labelPeriod} ${planName} limit`,
            remaining: remain,
            resetAt,
            detail,
        });
    }
    else if (creditsCfg) {
        // Auth + period metadata only — keep the card informative even when xAI
        // returns no quantitative usage fields on either endpoint.
        const resetAt = creditsCfg.currentPeriod?.end ?? creditsCfg.weeklyResetAt ?? creditsCfg.billingPeriodEnd;
        const resetDate = formatGrokResetDate(resetAt);
        const detail = [
            creditsCfg.isUnifiedBillingUser
                ? "Unified billing active; no usage percent or ledger amounts returned"
                : "No usage percent or ledger amounts returned",
        ];
        if (resetDate)
            detail.push(`${periodLabel} period ends: ${resetDate}`);
        appendGrokProductDetail(detail, creditsCfg);
        appendGrokExtraUsageDetail(detail, creditsCfg);
        header.push(`Billing:        ${periodLabel.toLowerCase()} period (usage unavailable)`);
        if (detail.length || resetAt) {
            windows.push({
                label: `${periodLabel} ${planName} limit`,
                remaining: 100,
                resetAt,
                detail,
                suffix: "usage unavailable",
            });
        }
    }
    if (!hasConsumer) {
        header.push("SuperGrok:      run `grok login` for weekly details");
    }
    // Liveness check: confirm at least one of the two tokens still works against
    // the xAI API. Prefer the consumer token (auto-refreshes via refresh_token)
    // and fall back to the opencode dev token. Either valid token is enough for
    // the card to be meaningful.
    try {
        const res = await fetchTimeout("https://api.x.ai/v1/models", {
            headers: {
                Authorization: `Bearer ${creditsToken}`,
                Accept: "application/json",
                "x-grok-source": "opencode-allstatus",
            },
        });
        if (!res.ok)
            throw new Error(`xAI API error (${res.status})`);
    }
    catch (err) {
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
//   Response shape:  model_remains[] with 5h + weekly windows. Current plans
//                    use one unified pool across supported capabilities; older
//                    responses may still name separate capability buckets.
const MINIMAX_BASE_URLS = ["https://www.minimax.io", "https://api.minimax.io"];
const MINIMAX_PLAN_LABELS = {
    general: "General (text/M3)",
    image: "Image",
    speech: "Speech",
    audio: "Audio",
    video: "Video",
};
function minimaxWindowLabel(bucketName, kind) {
    const label = MINIMAX_PLAN_LABELS[bucketName] ?? bucketName;
    return kind === "interval" ? `${label} — 5h` : `${label} — 7-day`;
}
function minimaxResetSeconds(raw, kind) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
        return undefined;
    const expected = kind === "interval" ? 5 * 3600 : 7 * 86_400;
    const candidates = [raw, raw / 1000].filter((value) => value > 0);
    const best = candidates.sort((a, b) => Math.abs(Math.log(a / expected)) - Math.abs(Math.log(b / expected)))[0];
    return Math.max(1, Math.floor(best));
}
function minimaxResetAt(raw) {
    const ms = epochToMs(raw);
    if (ms === undefined || ms < Date.now() - 86_400_000)
        return undefined;
    return epochToIso(ms);
}
function minimaxWindow(bucketName, kind, pct, used, total, resetRaw, status, endTime) {
    const remain = Math.max(0, Math.min(100, Math.round(pct ?? 100)));
    const throttled = status !== undefined && status !== 1;
    const detail = [];
    if (typeof total === "number" && total > 0 && typeof used === "number") {
        detail.push(`Used: ${used} / ${total}`);
    }
    const resetAt = minimaxResetAt(endTime);
    const resetSec = resetAt ? undefined : minimaxResetSeconds(resetRaw, kind);
    return {
        label: minimaxWindowLabel(bucketName, kind),
        remaining: remain,
        warn: throttled ? `\u26a0\ufe0f throttled (status=${status})` : undefined,
        detail,
        resetAt,
        resetInSec: resetSec !== undefined && resetSec > 0 ? resetSec : undefined,
    };
}
function minimaxHasWindow(pct, used, total, reset, endTime) {
    return [pct, used, total, reset, endTime].some((value) => typeof value === "number" && Number.isFinite(value));
}
function minimaxBucketSortKey(name) {
    if (name === "general")
        return 0;
    return 1;
}
async function queryMiniMax(auth, ansi = false) {
    if (!auth?.key)
        return null;
    if (!auth.key.startsWith("sk-cp-")) {
        return {
            success: false,
            error: `\u26a0\ufe0f Key is not a Token Plan subscription key (expected sk-cp- prefix).\n` +
                `Use the Token Plan key from MiniMax Console \u2192 Billing \u2192 Token Plan.`,
        };
    }
    try {
        const headers = {
            Authorization: `Bearer ${auth.key}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "OpenCode-AllStatus/1.0",
        };
        let res;
        for (const baseUrl of MINIMAX_BASE_URLS) {
            res = await fetchTimeout(`${baseUrl}/v1/token_plan/remains`, { headers });
            if (res.ok)
                break;
        }
        if (!res)
            throw new Error("MiniMax API did not return a response");
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`MiniMax API error (${res.status}): ${body.slice(0, 200)}`);
        }
        const data = (await res.json());
        if (data.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0) {
            throw new Error(`MiniMax API error: ${data.base_resp.status_msg ?? `code ${data.base_resp.status_code}`}`);
        }
        const buckets = (data.model_remains ?? [])
            .filter((b) => typeof b.model_name === "string")
            .sort((a, b) => {
            const ka = minimaxBucketSortKey(a.model_name);
            const kb = minimaxBucketSortKey(b.model_name);
            if (ka !== kb)
                return ka - kb;
            return a.model_name.localeCompare(b.model_name);
        });
        if (buckets.length === 0) {
            return {
                success: true,
                cards: [{ header: ["Plan:           Token Plan (no active buckets returned)"] }],
            };
        }
        const multi = buckets.length > 1;
        const cards = [];
        for (const b of buckets) {
            const name = b.model_name;
            const windows = [];
            if (minimaxHasWindow(b.current_interval_remaining_percent, b.current_interval_usage_count, b.current_interval_total_count, b.remains_time, b.end_time)) {
                windows.push(minimaxWindow(name, "interval", b.current_interval_remaining_percent, b.current_interval_usage_count, b.current_interval_total_count, b.remains_time, b.current_interval_status, b.end_time));
            }
            if (minimaxHasWindow(b.current_weekly_remaining_percent, b.current_weekly_usage_count, b.current_weekly_total_count, b.weekly_remains_time, b.weekly_end_time)) {
                windows.push(minimaxWindow(name, "weekly", b.current_weekly_remaining_percent, b.current_weekly_usage_count, b.current_weekly_total_count, b.weekly_remains_time, b.current_weekly_status, b.weekly_end_time));
            }
            cards.push({
                subtitle: multi ? name : undefined,
                windows: windows.length ? windows : undefined,
            });
        }
        return { success: true, cards };
    }
    catch (err) {
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
function stepfunCookiesPath() {
    return findReadable("stepfun-cookies.json", "config")
        ?? join(opencodeConfigDir(), "stepfun-cookies.json");
}
function loadStepFunCookies() {
    try {
        const p = stepfunCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const cfg = JSON.parse(raw);
        if (cfg.oasisToken && cfg.oasisWebid)
            return cfg;
        return null;
    }
    catch {
        return null;
    }
}
function stepfunDashboardHeaders(cookies) {
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
function stepfunResetAt(epochSec) {
    return epochToIso(epochSec);
}
async function queryStepFun(ansi = false) {
    const cookies = loadStepFunCookies();
    if (!cookies)
        return null;
    const headers = stepfunDashboardHeaders(cookies);
    try {
        const [rateRes, planRes] = await Promise.all([
            fetchTimeout(`${STEPFUN_DASHBOARD_BASE}/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`, { method: "POST", headers, body: "{}" }),
            fetchTimeout(`${STEPFUN_DASHBOARD_BASE}/api/step.openapi.devcenter.Dashboard/GetStepPlanStatus`, { method: "POST", headers, body: "{}" }),
        ]);
        // Parse rate limit data
        let rateLimit = null;
        if (rateRes.ok) {
            try {
                const data = (await rateRes.json());
                if (data.status === 1)
                    rateLimit = data;
            }
            catch { /* keep null */ }
        }
        // Parse plan status data
        let planStatus = null;
        if (planRes.ok) {
            try {
                const data = (await planRes.json());
                if (data.status === 1)
                    planStatus = data;
            }
            catch { /* keep null */ }
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
        const header = [];
        const plan = planStatus?.subscription;
        const def = planStatus?.plan_definition;
        if (plan) {
            header.push(`Plan:           ${plan.name}`);
            if (plan.auto_renew) {
                const exp = plan.expired_at ? stepfunResetAt(plan.expired_at) : undefined;
                if (exp)
                    header.push(`Renews:          ${formatResetAt(exp)}`);
            }
            else {
                const exp = plan.expired_at ? stepfunResetAt(plan.expired_at) : undefined;
                if (exp)
                    header.push(`Expires:         ${formatResetAt(exp)}`);
            }
            if (def?.price) {
                const priceNum = Number(def.price) / 100;
                if (Number.isFinite(priceNum)) {
                    header.push(`Price:           $${priceNum.toFixed(2)}/mo`);
                }
            }
        }
        const windows = [];
        if (rateLimit) {
            if (typeof rateLimit.five_hour_usage_left_rate === "number" &&
                Number.isFinite(rateLimit.five_hour_usage_left_rate)) {
                windows.push({
                    label: "5-hour rolling",
                    remaining: Math.round(clampPercent(rateLimit.five_hour_usage_left_rate * 100)),
                    resetAt: stepfunResetAt(rateLimit.five_hour_usage_reset_time),
                });
            }
            if (typeof rateLimit.weekly_usage_left_rate === "number" &&
                Number.isFinite(rateLimit.weekly_usage_left_rate)) {
                windows.push({
                    label: "Weekly",
                    remaining: Math.round(clampPercent(rateLimit.weekly_usage_left_rate * 100)),
                    resetAt: stepfunResetAt(rateLimit.weekly_usage_reset_time),
                });
            }
        }
        const footer = [];
        if (def?.support_models?.length) {
            footer.push(`Models:         ${def.support_models.join(", ")}`);
        }
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
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
function qwencloudCookiesPath() {
    return findReadable("qwencloud-cookies.json", "config")
        ?? join(opencodeConfigDir(), "qwencloud-cookies.json");
}
function loadQwenCloudCookies() {
    try {
        const p = qwencloudCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const cfg = JSON.parse(raw);
        if (cfg.ticket && cfg.aliyunPk && cfg.isg)
            return cfg;
        return null;
    }
    catch {
        return null;
    }
}
function qwencloudCookieString(cookies) {
    let c = `login_qwencloud_ticket=${cookies.ticket}; login_aliyunid_pk=${cookies.aliyunPk}; isg=${cookies.isg}`;
    if (cookies.esmTicket)
        c += `; login_ESM_account_ticket=${cookies.esmTicket}`;
    return c;
}
function qwencloudHeaders(cookies) {
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
async function qwencloudFetchSecToken(cookies) {
    try {
        const headers = qwencloudHeaders(cookies);
        delete headers["Content-Type"];
        const res = await fetchTimeout(`${QWENCLOUD_BASE}/`, {
            headers,
        });
        if (!res.ok)
            return null;
        const html = await res.text();
        const m = html.match(/SEC_TOKEN:\s*"([^"]+)"/);
        return m ? m[1] : null;
    }
    catch {
        return null;
    }
}
async function queryQwenCloud(ansi = false) {
    const cookies = loadQwenCloudCookies();
    if (!cookies)
        return null;
    // Step 1: get CSRF token from homepage
    const secToken = await qwencloudFetchSecToken(cookies);
    if (!secToken) {
        return {
            success: false,
            error: "Could not extract SEC_TOKEN from QwenCloud homepage.\n" +
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
            fetchTimeout(`${QWENCLOUD_BASE}/data/api.json?product=BssOpenAPI-V3&action=GetSeatSubscriptionSummary`, {
                method: "POST",
                headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
                body: params,
            }),
            fetchTimeout(`${QWENCLOUD_BASE}/data/api.json?product=BssOpenApi&action=CheckTokenPlanAutoRenewal`, {
                method: "POST",
                headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    CommodityCode: "sfm_tokenplanteams_dp_intl",
                }),
            }),
        ]);
        // Parse subscription summary
        let subData = null;
        if (subRes.ok) {
            try {
                subData = (await subRes.json());
            }
            catch { /* keep null */ }
        }
        // Parse auto-renewal
        let autoRenewal = null;
        if (renewalRes.ok) {
            try {
                const data = (await renewalRes.json());
                if (data.Success)
                    autoRenewal = data.Data.AutoRenewal === 1;
            }
            catch { /* keep null */ }
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
        const header = [
            `Plan:           Token Plan Team Edition (${spec}, ${seats} seat${seats > 1 ? "s" : ""})`,
        ];
        // Auto-renewal
        if (autoRenewal !== null) {
            header.push(`Auto-renewal:   ${autoRenewal ? "enabled" : "disabled"}`);
        }
        const windows = [];
        if (equity) {
            const total = Number(equity.TotalValue);
            const surplus = Number(equity.SurplusValue);
            const used = total - surplus;
            const remainPct = total > 0 ? Math.round(clampPercent((surplus / total) * 100)) : 100;
            windows.push({
                label: `Credits (${detail.RemainingDays ?? "?"}d remaining)`,
                remaining: remainPct,
                detail: [`Used: ${used.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
                resetAt: epochToIso(group?.NextCycleFlushTime),
            });
        }
        const footer = [];
        if (detail.EndTime) {
            const start = epochToMs(detail.StartTime);
            const end = epochToMs(detail.EndTime);
            if (start !== undefined && end !== undefined) {
                footer.push(`Cycle:          ${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
            }
        }
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
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
//   save as one of:
//
//     // Legacy single account:
//     { "cookie": "<full cookie string>" }
//
//     // Single account with an alias:
//     { "alias": "primary", "cookie": "<full cookie string>" }
//
//     // Multiple accounts (each gets its own card):
//     { "accounts": [
//         { "alias": "primary",   "cookie": "<cookie for account 1>" },
//         { "alias": "secondary", "cookie": "<cookie for account 2>" }
//       ]
//     }
//
//   For multi-account, sign in to each console.mistral.ai account in a
//   separate browser profile (or incognito session) and copy each cookie
//   blob into its own entry.
const MISTRAL_TRPC_URL = "https://console.mistral.ai/api-ui/trpc/user.me,vibe.getApiKey,billing.vibeUsage?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%2C%221%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%2C%222%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%7D";
function mistralCookiesPath() {
    return findReadable("mistral-cookies.json", "config")
        ?? join(opencodeConfigDir(), "mistral-cookies.json");
}
/**
 * Supported shapes for `mistral-cookies.json`:
 *
 *   { "cookie": "..." }                                // legacy single
 *   { "alias": "primary", "cookie": "..." }            // single + alias
 *   { "accounts": [{ "alias": "...", "cookie": "..." }, ...] }   // multi
 *   [ { "alias": "...", "cookie": "..." }, ... ]       // bare array
 */
function loadMistralCookies() {
    try {
        const p = mistralCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        const accounts = [];
        const pushIfValid = (value) => {
            if (!value || typeof value !== "object")
                return;
            const obj = value;
            const cookie = typeof obj.cookie === "string" ? obj.cookie : null;
            if (!cookie)
                return;
            const alias = typeof obj.alias === "string" && obj.alias.length > 0 ? obj.alias : undefined;
            accounts.push(alias ? { alias, cookie } : { cookie });
        };
        if (Array.isArray(parsed)) {
            for (const item of parsed)
                pushIfValid(item);
        }
        else if (parsed && typeof parsed === "object") {
            const obj = parsed;
            if (Array.isArray(obj.accounts)) {
                for (const item of obj.accounts)
                    pushIfValid(item);
            }
            else {
                pushIfValid(parsed);
            }
        }
        return accounts.length > 0 ? accounts : null;
    }
    catch {
        return null;
    }
}
function extractCsrfToken(cookieHeader) {
    const match = cookieHeader.match(/csrftoken=([^;]+)/);
    return match ? match[1] : null;
}
async function queryMistralAccount(account, fallbackLabel) {
    const csrfToken = extractCsrfToken(account.cookie);
    if (!csrfToken) {
        return {
            error: `Could not extract csrftoken from cookie for ${fallbackLabel}.\n` +
                "Ensure the cookie value contains a csrftoken field.",
        };
    }
    const headers = {
        Cookie: account.cookie,
        "x-csrftoken": csrfToken,
        "trpc-accept": "application/jsonl",
        "User-Agent": "OpenCode-AllStatus/1.0",
    };
    try {
        const res = await fetchTimeout(MISTRAL_TRPC_URL, { method: "GET", headers });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Mistral API error (${res.status}): ${body.slice(0, 200)}`);
        }
        const text = await res.text();
        let usagePercentage = null;
        let resetAt = null;
        let email = null;
        const pctMatch = text.match(/"usage_percentage"\s*:\s*(\d+(?:\.\d+)?)/);
        if (pctMatch)
            usagePercentage = parseFloat(pctMatch[1]);
        const resetMatch = text.match(/"reset_at"\s*:\s*"([^"]+)"/);
        if (resetMatch)
            resetAt = resetMatch[1];
        const emailMatch = text.match(/"email"\s*:\s*"([^"]+)"/);
        if (emailMatch)
            email = emailMatch[1];
        if (usagePercentage === null) {
            return { error: `${fallbackLabel}: failed to parse usage_percentage from response.` };
        }
        const remainPct = Math.round(clampPercent(100 - usagePercentage));
        const identity = email ?? account.alias ?? fallbackLabel;
        const sectionHeader = account.alias && email && account.alias !== email
            ? `${email} (${account.alias})`
            : identity;
        return {
            windows: [
                {
                    label: "Monthly Vibe budget",
                    trendKey: `Monthly Vibe budget · ${identity}`,
                    sectionHeader,
                    remaining: remainPct,
                    resetAt: resetAt ?? undefined,
                },
            ],
        };
    }
    catch (err) {
        return { error: `${fallbackLabel}: ${err instanceof Error ? err.message : String(err)}` };
    }
}
async function queryMistral(_a, _ansi = false) {
    const accounts = loadMistralCookies();
    if (!accounts)
        return null;
    const results = await Promise.all(accounts.map((acct, idx) => queryMistralAccount(acct, acct.alias ?? `Account ${idx + 1}`)));
    const allWindows = [];
    const errors = [];
    for (const r of results) {
        if (r.windows)
            allWindows.push(...r.windows);
        if (r.error)
            errors.push(r.error);
    }
    if (allWindows.length === 0) {
        return {
            success: false,
            error: errors.length > 0 ? errors.join("\n") : "Mistral Vibe: no account data returned.",
        };
    }
    return {
        success: true,
        cards: [{ windows: allWindows }],
        ...(errors.length > 0 ? { error: errors.join("\n") } : {}),
    };
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
const BYTEPLUS_API_URL = "https://console.byteplus.com/api/top/ark/ap-southeast-1/2024-01-01/GetCodingPlanUsage";
function byteplusCookiesPath() {
    return findReadable("byteplus-cookies.json", "config")
        ?? join(opencodeConfigDir(), "byteplus-cookies.json");
}
function loadBytePlusCookies() {
    try {
        const p = byteplusCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        const cookie = typeof parsed.cookie === "string" ? parsed.cookie : null;
        if (!cookie)
            return null;
        return { cookie };
    }
    catch {
        return null;
    }
}
function extractBytePlusCsrfToken(cookieHeader) {
    const match = cookieHeader.match(/csrfToken=([^;]+)/);
    return match ? match[1] : null;
}
async function queryBytePlus(_a, ansi = false) {
    const cookies = loadBytePlusCookies();
    if (!cookies)
        return null;
    const csrfToken = extractBytePlusCsrfToken(cookies.cookie);
    if (!csrfToken) {
        return {
            success: false,
            error: "Could not extract csrfToken from byteplus-cookies.json cookie string.\n" +
                "Ensure the cookie value contains a csrfToken field.",
        };
    }
    const headers = {
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
        const data = (await res.json());
        // Check for application-level errors in the response envelope
        const error = data.ResponseMetadata?.Error;
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
        const header = [`Plan:           BytePlus Ark Coding Plan`];
        if (result.Status) {
            header.push(`Status:          ${result.Status}`);
        }
        // Sort order: session first, then weekly, then monthly
        const sortOrder = { session: 0, weekly: 1, monthly: 2 };
        const sortedUsage = [...result.QuotaUsage].sort((a, b) => (sortOrder[a.Level.toLowerCase()] ?? 999) - (sortOrder[b.Level.toLowerCase()] ?? 999));
        const windows = [];
        for (const usage of sortedUsage) {
            const level = usage.Level;
            const percent = usage.Percent;
            const resetTs = usage.ResetTimestamp;
            if (typeof level !== "string" || typeof percent !== "number" || typeof resetTs !== "number") {
                continue; // skip malformed entries
            }
            const label = level.charAt(0).toUpperCase() + level.slice(1);
            const remaining = Math.round(clampPercent(100 - percent));
            const resetAt = epochToIso(resetTs);
            windows.push({ label, remaining, resetAt });
        }
        return {
            success: true,
            cards: [{ header, windows: windows.length ? windows : undefined }],
        };
    }
    catch (err) {
        return {
            success: false,
            error: `BytePlus: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
// ============================================================
// AtlasCloud Coding Plan (console.atlascloud.ai)
// ============================================================
//
//   Quota source:    POST   https://console.atlascloud.ai/api/v1/codeplan/get
//   History source:  GET    https://console.atlascloud.ai/api/v1/codeplan/costs
//   Account lookup:  GET    https://console.atlascloud.ai/api/v1/current-user
//   Auth:            Browser session cookies stored in
//                    ~/.config/opencode/atlas-cookies.json
//   Account header:  X-Account-ID = currentAccountUuid from /current-user
//
//   To set up: log into console.atlascloud.ai, open DevTools → Application →
//   Cookies, copy at least the `access-token` cookie value (full cookie
//   string also fine), and save as:
//     { "cookie": "access-token=...; g_state=...; _atlas_user_hint=..." }
//
//   Coding-plan key (apikey-…) cannot read the console API; only the
//   browser JWT cookie can.
const ATLASCLOUD_BASE = "https://console.atlascloud.ai";
const ATLASCLOUD_REFERER = "https://www.atlascloud.ai/";
const ATLASCLOUD_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:151.0) Gecko/20100101 Firefox/151.0";
function atlasCookiesPath() {
    return (findReadable("atlas-cookies.json", "config") ??
        join(opencodeConfigDir(), "atlas-cookies.json"));
}
function loadAtlasCookies() {
    try {
        const p = atlasCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        const cookie = typeof parsed.cookie === "string" ? parsed.cookie.trim() : null;
        if (!cookie)
            return null;
        const accountUuid = typeof parsed.accountUuid === "string" && parsed.accountUuid.trim()
            ? parsed.accountUuid.trim()
            : undefined;
        return { cookie, accountUuid };
    }
    catch {
        return null;
    }
}
function atlasHeaders(cookie, accountUuid) {
    const h = {
        Cookie: cookie,
        "User-Agent": ATLASCLOUD_USER_AGENT,
        Accept: "*/*",
        Origin: "https://www.atlascloud.ai",
        Referer: ATLASCLOUD_REFERER,
        "Content-Type": "application/json",
    };
    if (accountUuid)
        h["X-Account-ID"] = accountUuid;
    return h;
}
function extractAtlasAccessTokenExp(cookieHeader) {
    const m = cookieHeader.match(/access-token=([^;]+)/);
    if (!m)
        return undefined;
    const payload = parseJwtPayload(m[1]);
    if (!payload)
        return undefined;
    const exp = payload.exp;
    if (typeof exp === "number" && Number.isFinite(exp))
        return exp;
    return undefined;
}
async function fetchAtlasCurrentUser(cookie) {
    try {
        const res = await fetchTimeout(`${ATLASCLOUD_BASE}/api/v1/current-user`, {
            headers: atlasHeaders(cookie),
        });
        if (!res.ok)
            return null;
        const json = (await res.json());
        return json.data ?? null;
    }
    catch {
        return null;
    }
}
async function fetchAtlasCodePlan(cookie, accountUuid) {
    const res = await fetchTimeout(`${ATLASCLOUD_BASE}/api/v1/codeplan/get`, {
        method: "POST",
        headers: atlasHeaders(cookie, accountUuid),
        body: "",
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AtlasCloud codeplan/get error (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json());
    return json.data ?? [];
}
async function fetchAtlasRecentCosts(cookie, accountUuid, windowMs = 86_400_000, pageSize = 5) {
    const now = Date.now();
    const url = new URL(`${ATLASCLOUD_BASE}/api/v1/codeplan/costs`);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("startTime", String(now - windowMs));
    url.searchParams.set("endTime", String(now));
    try {
        const res = await fetchTimeout(url.toString(), { headers: atlasHeaders(cookie, accountUuid) });
        if (!res.ok)
            return null;
        const json = (await res.json());
        return json.data ?? null;
    }
    catch {
        return null;
    }
}
function formatAtlasExpiry(expiredAt) {
    const iso = epochToIso(expiredAt);
    return iso ? { iso, text: formatResetAt(iso) } : { text: "-" };
}
function atlasNumber(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value === "string" && !value.trim())
        return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function atlasCredits(value) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function atlasQuotaWindows(subscription, expiry) {
    const planType = subscription.PlanType.trim().toLowerCase();
    const isPackage = planType === "package";
    const balance = atlasNumber(subscription.balance);
    const dailyQuota = atlasNumber(subscription.DailyQuota);
    const packageQuota = atlasNumber(subscription.PackageQuota);
    const totalQuota = isPackage
        ? packageQuota
        : atlasNumber(subscription.total_quota) ?? dailyQuota;
    const usedQuota = atlasNumber(subscription.used_quota);
    const weeklyQuota = atlasNumber(subscription.weekly_quota);
    const weeklyCap = atlasNumber(subscription.weekly_cap) ?? 0;
    const weeklyRemaining = atlasNumber(subscription.weekly_remaining) ?? balance;
    const weeklyUsed = atlasNumber(subscription.weekly_used) ?? (weeklyQuota !== undefined && weeklyRemaining !== undefined
        ? Math.max(0, weeklyQuota - weeklyRemaining)
        : undefined);
    const trendPrefix = `${subscription.PlanName} · ${subscription.PlanID}`;
    const windows = [];
    if (isPackage && totalQuota !== undefined && totalQuota > 0 && balance !== undefined) {
        windows.push({
            label: "Pay-as-you-go pack",
            trendKey: `${trendPrefix} · Package`,
            remaining: Math.round(clampPercent((balance / totalQuota) * 100)),
            resetAt: expiry.iso,
            detail: [`Used: ${atlasCredits(Math.max(0, totalQuota - balance))} / ${atlasCredits(totalQuota)} credits`],
        });
        return windows;
    }
    // Current monthly subscriptions use a dual cap. weekly_cap is the backend's
    // explicit signal that the weekly pool is enforced; total_quota/used_quota
    // is the independent full-cycle pool.
    if (weeklyCap > 0 &&
        weeklyQuota !== undefined && weeklyQuota > 0 &&
        weeklyRemaining !== undefined) {
        const detail = weeklyUsed !== undefined
            ? [`Used this week: ${atlasCredits(weeklyUsed)} / ${atlasCredits(weeklyQuota)} credits`]
            : undefined;
        windows.push({
            label: "Weekly plan cap",
            trendKey: `${trendPrefix} · Weekly`,
            remaining: Math.round(clampPercent((weeklyRemaining / weeklyQuota) * 100)),
            resetAt: nextWeeklyResetIso(),
            detail,
        });
    }
    if (totalQuota !== undefined && totalQuota > 0) {
        const totalRemaining = usedQuota !== undefined
            ? Math.max(0, totalQuota - usedQuota)
            : weeklyCap <= 0 && balance !== undefined
                ? balance
                : undefined;
        if (totalRemaining !== undefined) {
            windows.push({
                label: weeklyCap > 0 ? "Monthly plan total" : "Plan total",
                trendKey: `${trendPrefix} · Total`,
                remaining: Math.round(clampPercent((totalRemaining / totalQuota) * 100)),
                resetAt: expiry.iso,
                detail: [`Used: ${atlasCredits(Math.max(0, totalQuota - totalRemaining))} / ${atlasCredits(totalQuota)} credits`],
            });
        }
    }
    // Backward compatibility for AtlasCloud's former daily-reset response.
    if (!windows.length && dailyQuota !== undefined && dailyQuota > 0 && balance !== undefined) {
        windows.push({
            label: "Daily quota (legacy plan)",
            trendKey: `${trendPrefix} · Daily`,
            remaining: Math.round(clampPercent((balance / dailyQuota) * 100)),
            resetAt: nextDailyResetIso(),
            detail: [`Used today: ${atlasCredits(Math.max(0, dailyQuota - balance))} / ${atlasCredits(dailyQuota)} credits`],
        });
    }
    return windows;
}
function atlasRecentCostLines(recent) {
    if (!recent?.items.length)
        return [];
    const lines = ["", `Recent calls (last 24h, ${recent.total} total, top 5):`];
    const top = recent.items.slice(0, 5);
    for (const item of top) {
        const time = epochToIso(item.finishTime)?.slice(11, 16) ?? "--:--";
        const cost = Math.round(Number(item.amount ?? 0)).toLocaleString();
        const input = item.usage?.input ?? 0;
        const output = item.usage?.output ?? 0;
        lines.push(`  ${time}  ${item.model.padEnd(30)} ${String(input).padStart(6)}in/${String(output).padStart(4)}out  -${cost}`);
    }
    const used = top.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    if (Number.isFinite(used))
        lines.push(`  (top-5 24h burn: -${Math.round(used).toLocaleString()})`);
    return lines;
}
async function queryAtlasCloud(_a, ansi = false) {
    const cookies = loadAtlasCookies();
    if (!cookies)
        return null;
    if (!/access-token=/.test(cookies.cookie)) {
        return {
            success: false,
            error: "atlas-cookies.json found but `cookie` value is missing the `access-token=` JWT.\n" +
                "Copy the full cookie string from console.atlascloud.ai including access-token.",
        };
    }
    const jwtExp = extractAtlasAccessTokenExp(cookies.cookie);
    if (jwtExp && jwtExp * 1000 < Date.now()) {
        return {
            success: false,
            error: "⚠️ AtlasCloud session cookie expired.\n" +
                "Re-login at https://console.atlascloud.ai and refresh atlas-cookies.json.",
        };
    }
    let accountUuid = cookies.accountUuid;
    let accountEmail;
    let accountName;
    try {
        const user = await fetchAtlasCurrentUser(cookies.cookie);
        if (user) {
            accountUuid = accountUuid ?? user.currentAccountUuid;
            accountEmail = user.email;
            accountName = user.name;
        }
    }
    catch {
        // tolerate failure — fall back to configured accountUuid
    }
    if (!accountUuid) {
        return {
            success: false,
            error: "AtlasCloud: could not resolve accountUuid.\n" +
                "Either /current-user failed (cookie invalid) or add accountUuid to atlas-cookies.json.",
        };
    }
    try {
        const subs = await fetchAtlasCodePlan(cookies.cookie, accountUuid);
        const activeSubs = subs.filter((subscription) => /active/i.test(subscription.Status));
        if (!activeSubs.length && subs[0])
            activeSubs.push(subs[0]);
        if (!activeSubs.length) {
            return {
                success: true,
                cards: [
                    {
                        header: [
                            `Account:        ${accountEmail ?? accountName ?? "AtlasCloud"}`,
                            "Plan:           AtlasCloud Coding Plan (no active subscription)",
                        ],
                    },
                ],
            };
        }
        const recent = await fetchAtlasRecentCosts(cookies.cookie, accountUuid, 86_400_000, 5);
        const multi = activeSubs.length > 1;
        const cards = activeSubs.map((active, index) => {
            const expiry = formatAtlasExpiry(active.ExpiredAt);
            const header = [];
            if (accountEmail || accountName) {
                header.push(`Account:        ${accountEmail ?? accountName}`);
            }
            const price = active.Price ? ` ($${active.Price}/${active.PlanType})` : ` (${active.PlanType})`;
            header.push(`Plan:           AtlasCloud ${active.PlanName}${price}`);
            header.push(`Status:         ${active.Status}${active.AutoRenewal ? " · auto-renew" : ""}`);
            const footer = [];
            if (expiry.iso) {
                footer.push(`Plan expires:   ${expiry.text} (${expiry.iso.slice(0, 10)})`);
            }
            if (index === 0 && jwtExp) {
                const cookieExp = epochToIso(jwtExp);
                if (cookieExp) {
                    footer.push(`Cookie expires: ${formatResetAt(cookieExp)} (${cookieExp.slice(0, 10)})`);
                }
            }
            if (index === 0)
                footer.push(...atlasRecentCostLines(recent));
            const windows = atlasQuotaWindows(active, expiry);
            if (!windows.length)
                footer.push("No recognized quota counters were returned for this plan.");
            return {
                subtitle: multi ? `${active.PlanName} · ${active.PlanType}` : undefined,
                header,
                windows: windows.length ? windows : undefined,
                footer: footer.length ? footer : undefined,
            };
        });
        return {
            success: true,
            cards,
        };
    }
    catch (err) {
        return {
            success: false,
            error: `AtlasCloud: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
// Daily quota resets at UTC midnight (per AtlasCloud dashboard behavior).
function nextDailyResetIso() {
    const now = new Date();
    const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return reset.toISOString();
}
// Current AtlasCloud subscriptions reset the weekly cap every Monday at
// 00:00 UTC, independently of the plan-expiry/monthly total.
function nextWeeklyResetIso() {
    const now = new Date();
    const day = now.getUTCDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday)).toISOString();
}
// ============================================================
// Ollama Cloud (ollama.com/settings)
// ============================================================
//
//   Quota source:    GET https://ollama.com/settings (SSR HTML)
//   Billing enrich:  GET https://ollama.com/settings/billing (renewal date)
//   Auth:            Browser session cookies in ollama-cookies.json
//
//   { "cookie": "__Secure-session=...; aid=..." }
//
//   Inference API keys (auth.json → ollama-cloud) cannot read account quota.
const OLLAMA_SETTINGS_URL = "https://ollama.com/settings";
const OLLAMA_BILLING_URL = "https://ollama.com/settings/billing";
const OLLAMA_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:151.0) Gecko/20100101 Firefox/151.0";
function ollamaCookiesPath() {
    return findReadable("ollama-cookies.json", "config")
        ?? join(opencodeConfigDir(), "ollama-cookies.json");
}
function loadOllamaCookies() {
    try {
        const p = ollamaCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        const cookie = typeof parsed.cookie === "string" ? parsed.cookie.trim() : null;
        if (!cookie)
            return null;
        return { cookie };
    }
    catch {
        return null;
    }
}
function parseOllamaUsageBlock(html, kind) {
    const usedMatch = html.match(new RegExp(`aria-label="${kind} usage ([\\d.]+)% used"`));
    if (!usedMatch)
        return null;
    const anchor = html.indexOf(`aria-label="${kind} usage`);
    const sliceStart = anchor >= 0 ? anchor : 0;
    const weeklyIdx = html.indexOf("Weekly usage");
    const sliceEnd = kind === "Session" && weeklyIdx > sliceStart ? weeklyIdx : html.length;
    const block = html.slice(sliceStart, sliceEnd);
    const resetMatch = block.match(/data-time="([^"]+)"/);
    const models = [...block.matchAll(/data-model="([^"]+)"\s+data-requests="(\d+)"/g)].map((m) => ({
        model: m[1],
        requests: Number(m[2]),
    }));
    return {
        usedPct: parseFloat(usedMatch[1]),
        resetAt: resetMatch?.[1],
        models,
    };
}
function parseOllamaSettingsHtml(html) {
    if (!html.includes("Cloud usage"))
        return null;
    const email = html.match(/class="text-sm text-neutral-500 break-words">([^<]+)/)?.[1]?.trim();
    const plan = html.match(/Cloud usage<\/span>\s*<span[^>]*>\s*(\w+)\s*<\/span>/s)?.[1]?.trim();
    const extraBalanceUsd = html
        .match(/Balance remaining<\/div>\s*<div[^>]*>\$([^<]+)/)?.[1]
        ?.trim();
    const windows = [];
    const session = parseOllamaUsageBlock(html, "Session");
    const weekly = parseOllamaUsageBlock(html, "Weekly");
    if (session)
        windows.push({ label: "Session", ...session });
    if (weekly)
        windows.push({ label: "Weekly", ...weekly });
    if (!windows.length)
        return null;
    return { email, plan, extraBalanceUsd, windows };
}
function parseOllamaBillingRenewal(html) {
    return html.match(/subscription renews on\s*<span[^>]*>([^<]+)<\/span>/i)?.[1]?.trim();
}
async function fetchOllamaHtml(url, cookie) {
    const res = await fetchTimeout(url, {
        headers: {
            Cookie: cookie,
            Accept: "text/html",
            "User-Agent": OLLAMA_USER_AGENT,
        },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.text();
}
async function queryOllama(_a, _ansi = false) {
    const cookies = loadOllamaCookies();
    if (!cookies)
        return null;
    if (!/__Secure-session=/.test(cookies.cookie)) {
        return {
            success: false,
            error: "ollama-cookies.json found but `cookie` is missing `__Secure-session=`.\n" +
                "Copy the Cookie header from ollama.com after signing in (DevTools → Network).",
        };
    }
    try {
        const settingsHtml = await fetchOllamaHtml(OLLAMA_SETTINGS_URL, cookies.cookie);
        const parsed = parseOllamaSettingsHtml(settingsHtml);
        if (!parsed) {
            return {
                success: false,
                error: "⚠️ Ollama session invalid or settings page layout changed.\n" +
                    "Re-login at https://ollama.com and refresh ollama-cookies.json.",
            };
        }
        let renewal;
        try {
            const billingHtml = await fetchOllamaHtml(OLLAMA_BILLING_URL, cookies.cookie);
            renewal = parseOllamaBillingRenewal(billingHtml);
        }
        catch {
            // billing page is optional enrichment
        }
        const header = [];
        if (parsed.email)
            header.push(`Account:        ${parsed.email}`);
        if (parsed.plan)
            header.push(`Plan:           Ollama ${parsed.plan}`);
        const windows = parsed.windows.map((w) => ({
            label: w.label,
            remaining: Math.max(0, Math.min(100, Math.round(100 - w.usedPct))),
            detail: [`Used: ${w.usedPct}%`],
            resetAt: w.resetAt,
        }));
        const footer = [];
        if (renewal)
            footer.push(`Subscription renews: ${renewal}`);
        if (parsed.extraBalanceUsd !== undefined) {
            footer.push(`Extra usage balance: $${parsed.extraBalanceUsd}`);
        }
        const session = parsed.windows.find((w) => w.label === "Session");
        const weekly = parsed.windows.find((w) => w.label === "Weekly");
        if (session?.models.length || weekly?.models.length) {
            footer.push("");
            if (session?.models.length) {
                footer.push("Session models:");
                for (const m of session.models.slice(0, 6)) {
                    footer.push(`  ${m.model}: ${m.requests} request${m.requests === 1 ? "" : "s"}`);
                }
            }
            if (weekly?.models.length) {
                footer.push("Weekly models:");
                for (const m of weekly.models.slice(0, 8)) {
                    footer.push(`  ${m.model}: ${m.requests} request${m.requests === 1 ? "" : "s"}`);
                }
            }
        }
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
        return {
            success: false,
            error: `Ollama: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
// ============================================================
// LongCat API (longcat.chat platform)
// ============================================================
//
//   Quota source:    GET https://longcat.chat/api/lc-platform/v1/tokenUsage?day=today
//   Account source:  GET https://longcat.chat/api/v1/user-current
//   Auth:            Browser session cookies (passport_token_key + long_cat_region_key)
//                    stored in ~/.config/opencode/longcat-cookies.json
//   Note:            The inference API key (ak_…) in opencode.json cannot read quota.
//
//   To set up: log into https://longcat.chat/platform/usage, open DevTools → Network,
//   copy cookie values from any longcat.chat/api request, and save as either:
//     { "passportToken": "<passport_token_key>", "region": "2" }
//     { "cookie": "passport_token_key=...; long_cat_region_key=2; ..." }
const LONGCAT_PLATFORM_BASE = "https://longcat.chat";
const LONGCAT_APPKEY = "fe_com.sankuai.friday.longcat.platform";
const LONGCAT_EXT_SKIP_KEYS = new Set(["applyButtonGray", "newUser"]);
function longcatCookiesPath() {
    return findReadable("longcat-cookies.json", "config")
        ?? join(opencodeConfigDir(), "longcat-cookies.json");
}
function resolveLongCatSession(cfg) {
    const passportFromField = typeof cfg.passportToken === "string" ? cfg.passportToken.trim() : "";
    if (passportFromField) {
        const region = typeof cfg.region === "string" && cfg.region.trim() ? cfg.region.trim() : "2";
        return { passportToken: passportFromField, region };
    }
    const cookie = typeof cfg.cookie === "string" ? cfg.cookie.trim() : "";
    if (!cookie)
        return null;
    const passport = cookie.match(/(?:^|;\s*)passport_token_key=([^;]+)/)?.[1]?.trim();
    if (!passport)
        return null;
    const region = cookie.match(/(?:^|;\s*)long_cat_region_key=([^;]+)/)?.[1]?.trim() || "2";
    return { passportToken: passport, region };
}
function loadLongCatCookies() {
    try {
        const p = longcatCookiesPath();
        if (!existsSync(p))
            return null;
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        return resolveLongCatSession(parsed);
    }
    catch {
        return null;
    }
}
function longcatPlatformHeaders(session) {
    return {
        Cookie: `passport_token_key=${session.passportToken}; long_cat_region_key=${session.region}`,
        "m-appkey": LONGCAT_APPKEY,
        "content-type": "application/json",
        "x-client-language": "en",
        "x-requested-with": "XMLHttpRequest",
        Accept: "*/*",
        Referer: "https://longcat.chat/platform/usage",
        "User-Agent": "OpenCode-AllStatus/1.0",
    };
}
function longcatRemainPercent(remaining, total) {
    if (!Number.isFinite(total) || total <= 0)
        return 0;
    if (!Number.isFinite(remaining))
        return 0;
    return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}
function longcatModelEntries(extData) {
    if (!extData)
        return [];
    const out = [];
    for (const [key, val] of Object.entries(extData)) {
        if (LONGCAT_EXT_SKIP_KEYS.has(key))
            continue;
        if (!val || typeof val !== "object")
            continue;
        const usage = val;
        if (typeof usage.totalToken !== "number" &&
            typeof usage.freeRefreshToken !== "number" &&
            typeof usage.availableToken !== "number") {
            continue;
        }
        out.push([key, usage]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
}
function longcatFuelSummary(packages) {
    if (!packages?.length)
        return [];
    const active = packages.filter((p) => (p.remainQuota ?? 0) > 0);
    if (!active.length)
        return [];
    const totalRemain = active.reduce((sum, p) => sum + (p.remainQuota ?? 0), 0);
    const nearestExpire = active.reduce((min, p) => {
        const days = p.daysUntilExpire;
        if (typeof days !== "number" || !Number.isFinite(days))
            return min;
        return min === null ? days : Math.min(min, days);
    }, null);
    const lines = [`Fuel packages:  ${active.length} active · ${totalRemain.toLocaleString()} tokens remaining`];
    if (nearestExpire !== null) {
        lines.push(`Nearest expiry: ${nearestExpire}d`);
    }
    return lines;
}
async function fetchLongCatJson(path, session) {
    const url = `${LONGCAT_PLATFORM_BASE}${path}`;
    const res = await fetchTimeout(url, { headers: longcatPlatformHeaders(session) });
    const body = await res.text().catch(() => "");
    let data;
    try {
        data = JSON.parse(body);
    }
    catch {
        throw new Error(`LongCat API error (${res.status}): ${body.slice(0, 200)}`);
    }
    if (data.code === 401 || /not logged in/i.test(data.message ?? "")) {
        throw new Error("LongCat session expired or invalid.\n" +
            "Re-login at https://longcat.chat/platform/usage and refresh longcat-cookies.json.");
    }
    if (data.code !== 0) {
        throw new Error(`LongCat API error: ${data.message ?? `code ${data.code}`}`);
    }
    return data;
}
async function queryLongCat(_ansi = false) {
    const session = loadLongCatCookies();
    if (!session)
        return null;
    try {
        const [usageRes, userRes, keysRes] = await Promise.all([
            fetchLongCatJson(`/api/lc-platform/v1/tokenUsage?day=today&t=${Date.now()}`, session),
            fetchLongCatJson("/api/v1/user-current", session).catch(() => null),
            fetchLongCatJson("/api/lc-platform/v1/query-active-apiKeys", session).catch(() => null),
        ]);
        const models = longcatModelEntries(usageRes.data?.extData);
        if (models.length === 0) {
            return {
                success: true,
                cards: [{ header: ["Plan:           LongCat API (no usage data returned)"] }],
            };
        }
        const header = [];
        const email = userRes?.data?.email;
        const name = userRes?.data?.name;
        if (email)
            header.push(`Account:        ${email}`);
        else if (name)
            header.push(`Account:        ${name}`);
        header.push("Plan:           LongCat API");
        const activeKeys = keysRes?.data?.extData?.activeKeyCount;
        if (typeof activeKeys === "number") {
            header.push(`Active API keys: ${activeKeys}`);
        }
        const windows = [];
        const footer = [];
        const displayModels = [];
        for (const [modelKey, usage] of models) {
            const freeTotal = usage.freeRefreshToken ?? 0;
            const total = usage.totalToken ?? 0;
            if (freeTotal <= 0 && total <= 0)
                continue;
            displayModels.push([modelKey, usage]);
        }
        if (displayModels.length === 0) {
            return {
                success: true,
                cards: [{ header: [...header, "Status:         No active quota returned"] }],
            };
        }
        const multi = displayModels.length > 1;
        for (const [modelKey, usage] of displayModels) {
            const label = usage.aliasName ?? modelKey;
            const sectionHeader = multi ? label : undefined;
            const freeTotal = usage.freeRefreshToken ?? 0;
            const freeAvail = usage.freeAvailableToken ?? 0;
            if (freeTotal > 0) {
                const freeUsed = usage.freeUsedToken ?? Math.max(0, freeTotal - freeAvail);
                windows.push({
                    label: multi ? `${label} · Free quota` : "Free quota",
                    remaining: longcatRemainPercent(freeAvail, freeTotal),
                    sectionHeader,
                    trendKey: `${label} · Free`,
                    detail: [
                        `Used:           ${freeUsed.toLocaleString()} / ${freeTotal.toLocaleString()}`,
                    ],
                });
            }
            const total = usage.totalToken ?? 0;
            const avail = usage.availableToken ?? 0;
            if (total > 0) {
                const used = usage.usedToken ?? Math.max(0, total - avail);
                windows.push({
                    label: multi ? `${label} · Total tokens` : "Total tokens",
                    remaining: longcatRemainPercent(avail, total),
                    trendKey: `${label} · Total`,
                    detail: [`Used:           ${used.toLocaleString()} / ${total.toLocaleString()}`],
                });
            }
            const fuelLines = longcatFuelSummary(usage.fuelPackageList);
            if (fuelLines.length) {
                footer.push(...(multi ? [`${label}:`, ...fuelLines.map((l) => `  ${l}`)] : fuelLines));
            }
        }
        return {
            success: true,
            cards: [{ header, windows, footer: footer.length ? footer : undefined }],
        };
    }
    catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
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
function nanoGptResetAt(value) {
    return epochToIso(value);
}
function isRealNanoGptKey(key) {
    return typeof key === "string" && key.trim() !== "" && key.trim() !== NANOGPT_MULTI_AUTH_DUMMY_KEY;
}
function loadNanoGptMultiAuthCredentials() {
    try {
        const raw = readFileSync(nanoGptMultiAuthKeysPath(), "utf-8");
        const data = JSON.parse(raw);
        const credentials = [];
        for (const stored of data.keys ?? []) {
            if (stored.enabled === false || !isRealNanoGptKey(stored.key))
                continue;
            credentials.push({
                source: "multi-auth",
                label: stored.label ?? stored.id,
                key: stored.key.trim(),
                cooldownUntil: stored.cooldownUntil,
            });
        }
        return credentials;
    }
    catch {
        return [];
    }
}
function resolveNanoGptCredentials(auth) {
    const credentials = [];
    const seen = new Set();
    const add = (credential) => {
        const key = credential.key.trim();
        if (!isRealNanoGptKey(key) || seen.has(key))
            return;
        seen.add(key);
        credentials.push({ ...credential, key });
    };
    // Prefer multi-auth metadata for duplicate keys; it has user labels and pool state.
    for (const credential of loadNanoGptMultiAuthCredentials())
        add(credential);
    if (isRealNanoGptKey(auth?.key))
        add({ source: "native", label: "Native auth", key: auth.key });
    return credentials;
}
function nanoGptSubtitle(credential, multi) {
    if (!multi)
        return undefined;
    return credential.label?.trim() || (credential.source === "native" ? "Native auth" : "Multi-auth key");
}
function nanoGptAuthSource(credential) {
    return credential.source === "multi-auth" ? "NanoGPT multi-auth" : "OpenCode native auth";
}
function humanCount(n) {
    if (!Number.isFinite(n))
        return String(n);
    const abs = Math.abs(n);
    const trim = (v, dp) => v.toFixed(dp).replace(/\.0$/, "");
    if (abs >= 1e9)
        return trim(n / 1e9, abs >= 1e10 ? 0 : 1) + "B";
    if (abs >= 1e6)
        return trim(n / 1e6, abs >= 1e7 ? 0 : 1) + "M";
    if (abs >= 1e3)
        return trim(n / 1e3, abs >= 1e4 ? 0 : 1) + "K";
    return String(n);
}
function nanoGptWindow(label, w, limit, unit) {
    if (!w)
        return null;
    const used = typeof w.used === "number" && Number.isFinite(w.used) ? w.used : 0;
    const explicitRemaining = typeof w.remaining === "number" && Number.isFinite(w.remaining) ? w.remaining : undefined;
    const total = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? limit
        : explicitRemaining !== undefined
            ? used + explicitRemaining
            : 0;
    const remaining = explicitRemaining ?? (total > 0 ? Math.max(0, total - used) : 0);
    let remainPct;
    if (total > 0)
        remainPct = Math.round(clampPercent((remaining / total) * 100));
    else if (typeof w.percentUsed === "number" && Number.isFinite(w.percentUsed)) {
        const usedPercent = w.percentUsed <= 1 ? w.percentUsed * 100 : w.percentUsed;
        remainPct = Math.round(clampPercent(100 - usedPercent));
    }
    else
        remainPct = 100;
    const fmt = unit === "tokens" ? humanCount : (x) => x.toLocaleString();
    return {
        label,
        remaining: remainPct,
        resetAt: nanoGptResetAt(w.resetAt),
        detail: total > 0 ? [`Used: ${fmt(used)} / ${fmt(total)}`] : [`Used: ${fmt(used)}`],
    };
}
async function queryNanoGptCredential(credential, subtitle) {
    const headers = {
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
    const bal = (await balRes.json());
    const header = [`Auth source:     ${nanoGptAuthSource(credential)}`];
    const usd = Number(bal.usd_balance ?? "0");
    header.push(`Balance:        $${(Number.isFinite(usd) ? usd : 0).toFixed(2)}`);
    const nano = Number(bal.nano_balance ?? "0");
    if (Number.isFinite(nano) && nano > 0)
        header.push(`Nano (XNO):     ${nano.toFixed(4)}`);
    let sub = null;
    if (subRes.ok) {
        try {
            sub = (await subRes.json());
        }
        catch {
            /* no subscription body */
        }
    }
    const windows = [];
    const footer = [];
    if (credential.cooldownUntil && credential.cooldownUntil > Date.now()) {
        footer.push(`Pool cooldown:  ${formatDuration(Math.ceil((credential.cooldownUntil - Date.now()) / 1000))}`);
    }
    if (sub?.active || sub?.state === "grace") {
        const state = sub.state && sub.state !== "active" ? ` · ${sub.state}` : "";
        header.push(`Plan:           Subscription${sub.provider ? ` (${sub.provider})` : ""}${state}`);
        const built = [
            nanoGptWindow("Daily subscription operations", sub.daily, sub.limits?.daily, "operations"),
            nanoGptWindow("Monthly subscription operations", sub.monthly, sub.limits?.monthly, "operations"),
            nanoGptWindow("Weekly input tokens", sub.weeklyInputTokens, sub.limits?.weeklyInputTokens, "tokens"),
            nanoGptWindow("Daily input tokens", sub.dailyInputTokens, sub.limits?.dailyInputTokens, "tokens"),
            nanoGptWindow("Daily images", sub.dailyImages, sub.limits?.dailyImages, "images"),
        ];
        for (const w of built)
            if (w)
                windows.push(w);
        const end = sub.period?.currentPeriodEnd;
        if (end)
            footer.push(`${sub.cancelAtPeriodEnd ? "Ends" : "Renews"}:         ${formatResetAt(end)}`);
        if (sub.state === "grace" && sub.graceUntil) {
            footer.push(`Grace access ends: ${formatResetAt(sub.graceUntil)}`);
        }
    }
    else {
        header.push(`Plan:           Pay-as-you-go${sub?.state ? ` (subscription ${sub.state})` : ""}`);
    }
    return { subtitle, header, windows, footer: footer.length ? footer : undefined };
}
async function queryNanoGpt(auth, ansi = false) {
    const credentials = resolveNanoGptCredentials(auth);
    if (credentials.length === 0)
        return null;
    const multi = credentials.length > 1;
    const results = await Promise.all(credentials.map(async (credential) => {
        const subtitle = nanoGptSubtitle(credential, multi);
        try {
            return { card: await queryNanoGptCredential(credential, subtitle) };
        }
        catch (err) {
            const label = subtitle ?? "NanoGPT";
            const message = err instanceof Error ? err.message : String(err);
            return { error: `${label}: ${message}` };
        }
    }));
    const cards = [];
    const errors = [];
    for (const result of results) {
        if ("card" in result) {
            cards.push(result.card);
        }
        else {
            errors.push(result.error);
        }
    }
    if (cards.length > 0) {
        if (errors.length > 0)
            cards.push({ subtitle: multi ? "Errors" : undefined, header: errors });
        return { success: true, cards };
    }
    return { success: false, error: errors.join("\n\n") };
}
function shortProvider(title) {
    return title.replace(/ (Account Quota|Coding Plan)$/i, "");
}
function cellTitle(providerTitle, subTitle) {
    const short = shortProvider(providerTitle);
    if (subTitle.toLowerCase().startsWith(short.toLowerCase())) {
        return subTitle;
    }
    return `${short} \u2014 ${subTitle}`;
}
// Parse a "5d 2h 30m" / "4h" / "10m" / "now" / "resetting" countdown back to ms.
function parseResetToMs(text) {
    if (!text)
        return undefined;
    const t = text.trim().toLowerCase();
    if (t === "resetting" || t === "now" || t === "resets soon")
        return 0;
    let ms = 0;
    let matched = false;
    const re = /(\d+)\s*([dhm])/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        matched = true;
        const n = Number(m[1]);
        ms += m[2] === "d" ? n * 86_400_000 : m[2] === "h" ? n * 3_600_000 : n * 60_000;
    }
    return matched ? ms : undefined;
}
// Resolve a window's countdown text + ms-until-reset from whatever it carries.
function windowReset(w) {
    if (w.resetText)
        return { text: w.resetText, ms: parseResetToMs(w.resetText) };
    if (w.resetAt) {
        const ms = new Date(w.resetAt).getTime() - Date.now();
        if (!Number.isFinite(ms))
            return {};
        if (ms <= 0)
            return { text: "resetting", ms: 0 };
        return { text: formatDuration(Math.floor(ms / 1000)), ms };
    }
    if (typeof w.resetInSec === "number" && Number.isFinite(w.resetInSec)) {
        const s = Math.max(0, w.resetInSec);
        return { text: s <= 0 ? "resetting" : formatDuration(Math.floor(s)), ms: s * 1000 };
    }
    return {};
}
// Render a structured card into grid-cell lines + window metrics.
function cardToCell(card, providerTitle, ansi, trend) {
    const title = card.subtitle ? cellTitle(providerTitle, card.subtitle) : providerTitle;
    const lines = [];
    const metrics = [];
    if (card.note)
        lines.push(ansi ? `${ANSI_DIM}${card.note}${ANSI_RESET}` : card.note);
    if (card.header?.length)
        lines.push(...card.header);
    let needBlank = lines.length > 0; // separate header/note from first window
    for (const w of card.windows ?? []) {
        if (needBlank)
            lines.push("");
        needBlank = true;
        if (w.sectionHeader) {
            const divider = `── ${w.sectionHeader} ──`;
            lines.push(ansi ? `${ANSI_DIM}${divider}${ANSI_RESET}` : divider);
        }
        if (w.label)
            lines.push(w.label);
        if (w.warn)
            lines.push(w.warn);
        const remain = Math.max(0, Math.min(100, Math.round(w.remaining)));
        const suffix = w.suffix ?? `${remain}% remaining`;
        lines.push(`${createProgressBar(remain, 26, ansi)} ${suffix}`);
        const { text: resetText, ms: resetMs } = windowReset(w);
        const metricLabel = w.trendKey ?? w.label;
        if (trend) {
            const annotation = trend(title, metricLabel, remain, resetMs);
            if (annotation)
                lines.push(annotation);
        }
        if (w.detail?.length)
            lines.push(...w.detail);
        if (resetText)
            lines.push(`Resets in: ${resetText}`);
        if (w.extra?.length)
            lines.push(...w.extra);
        if (w.label)
            metrics.push({ cellTitle: title, label: metricLabel, remaining: remain, resetMs });
    }
    if (card.footer?.length) {
        if (lines.length > 0)
            lines.push("");
        lines.push(...card.footer);
    }
    return { title, lines, metrics };
}
function collect(result, providerTitle, cells, errors, ansi, trend) {
    if (!result)
        return;
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
                if (!trimmed)
                    continue;
                const m = trimmed.match(/^### (.+)\n?([\s\S]*)/);
                if (m) {
                    cells.push({ title: cellTitle(providerTitle, m[1].trim()), lines: (m[2] ?? "").split("\n") });
                }
                else {
                    cells.push({ title: providerTitle, lines: trimmed.split("\n") });
                }
            }
        }
        else {
            cells.push({ title: providerTitle, lines: result.output.split("\n") });
        }
    }
    else if (result.error) {
        errors.push(`${providerTitle}:\n${result.error}`);
    }
}
// ============================================================
// Metrics, alerts & summary
// ============================================================
function gatherMetrics(cells) {
    const all = [];
    for (const c of cells)
        if (c.metrics?.length)
            all.push(...c.metrics);
    return all;
}
// Minimum remaining % for a cell (structured metrics, with a legacy parse fallback).
function cellMinRemaining(cell) {
    let min = 101;
    if (cell.metrics?.length) {
        for (const m of cell.metrics)
            min = Math.min(min, m.remaining);
    }
    else {
        for (const line of cell.lines) {
            const m = line.match(/(\d+)% (?:remaining|of)/);
            if (m)
                min = Math.min(min, parseInt(m[1], 10));
        }
    }
    return min;
}
// Soonest reset across a cell's windows (ms), if any.
function cellSoonestReset(cell) {
    let soonest;
    for (const m of cell.metrics ?? []) {
        if (typeof m.resetMs === "number" && (soonest === undefined || m.resetMs < soonest)) {
            soonest = m.resetMs;
        }
    }
    return soonest;
}
function extractAlerts(cells, threshold = 25) {
    const alerts = [];
    for (const cell of cells) {
        const min = cellMinRemaining(cell);
        if (min > 0 && min <= threshold)
            alerts.push(`${cell.title}: ${min}%`);
    }
    return alerts;
}
// ============================================================
// JSON serialization
// ============================================================
function cellsToJson(cells, alerts, errors) {
    return JSON.stringify({
        cells: cells.map((c) => ({
            title: c.title,
            lines: c.lines.map((l) => l.replace(ANSI_RE, "")),
            metrics: c.metrics?.length ? c.metrics : undefined,
        })),
        alerts: alerts.length > 0 ? alerts : undefined,
        errors: errors.length > 0 ? errors : undefined,
    }, null, 2);
}
// ============================================================
// Rendering
// ============================================================
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) {
    return s.replace(ANSI_RE, "");
}
// Returns the number of terminal columns a string occupies.
// Wide characters (emoji, CJK, etc.) count as 2 columns; most others as 1.
function displayWidth(s) {
    let w = 0;
    for (const cp of s) {
        const code = cp.codePointAt(0) ?? 0;
        // Emoji / pictographs / misc symbols that render as 2-wide in terminals
        if ((code >= 0x1f300 && code <= 0x1f9ff) || // Misc symbols, emoticons, transport, etc.
            (code >= 0x2600 && code <= 0x27bf) || // Misc symbols & dingbats
            (code >= 0xfe00 && code <= 0xfe0f) || // Variation selectors
            (code >= 0x1f000 && code <= 0x1f02f) || // Mahjong / domino
            (code >= 0x1fa00 && code <= 0x1fa9f) || // Chess / symbols
            (code >= 0x4e00 && code <= 0xa4ff) || // CJK unified ideographs
            (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
            (code >= 0x20000 && code <= 0x2a6df) || // CJK extension B
            (code >= 0x2f800 && code <= 0x2fa1f) // CJK compatibility supplement
        ) {
            w += 2;
        }
        else {
            w += 1;
        }
    }
    return w;
}
function padLine(s, w) {
    const visual = stripAnsi(s);
    const vw = displayWidth(visual);
    if (vw > w) {
        let acc = 0;
        let cut = "";
        for (const cp of visual) {
            const cw = displayWidth(cp);
            if (acc + cw > w - 1)
                break;
            cut += cp;
            acc += cw;
        }
        cut += "\u2026";
        return cut + " ".repeat(Math.max(0, w - displayWidth(cut)));
    }
    return s + " ".repeat(Math.max(0, w - vw));
}
const MIN_INNER = 30; // narrowest interior (between the │ borders)
const MAX_INNER = 66; // widest interior, so cards stay readable on big screens
const PAD_X = 2; // left/right interior padding
const GUTTER = "  "; // horizontal gap between side-by-side cards
const GUTTER_W = GUTTER.length;
const MIN_TWO_COL = 2 * (MIN_INNER + 2) + GUTTER_W; // minimum termWidth for two columns
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
function truncateW(s, w) {
    if (displayWidth(s) <= w)
        return s;
    let acc = 0;
    let cut = "";
    for (const cp of s) {
        const cw = displayWidth(cp);
        if (acc + cw > w - 1)
            break;
        cut += cp;
        acc += cw;
    }
    return cut + "\u2026";
}
// Rescale an embedded progress bar (a run of █/░) to fit the space left in
// its panel, preserving the original fill ratio. Surrounding ANSI color
// codes and the emoji/label sit outside the glyph run, so they're untouched.
function fitBar(line, budget) {
    const m = line.match(/[\u2588\u2591]+/);
    if (!m || m.index === undefined)
        return line;
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
function columnInnerW(termWidth, colCount) {
    if (colCount <= 1) {
        return Math.max(MIN_INNER, Math.min(MAX_INNER, termWidth - 2));
    }
    const perCol = Math.floor((termWidth - GUTTER_W) / colCount) - 2;
    return Math.max(MIN_INNER, Math.min(MAX_INNER, perCol));
}
function resolveColumnCount(termWidth, layout) {
    const canFitTwo = termWidth >= MIN_TWO_COL;
    if (layout === "single")
        return 1;
    if (layout === "double")
        return canFitTwo ? 2 : 1;
    return canFitTwo ? 2 : 1;
}
function resolveLayout(explicit, cfg) {
    const v = (explicit ?? cfg.layout ?? "auto").toLowerCase();
    if (v === "single" || v === "double")
        return v;
    return "auto";
}
// Render one card as an array of terminal lines (header, body, footer).
function renderCard(cell, innerW) {
    const contentW = innerW - PAD_X * 2;
    const lines = [];
    const blankRow = BOX.v + " ".repeat(innerW) + BOX.v;
    const title = truncateW(cell.title, innerW - 4);
    lines.push(BOX.tl +
        BOX.h +
        " " +
        title +
        " " +
        BOX.h.repeat(Math.max(0, innerW - 3 - displayWidth(title))) +
        BOX.tr);
    lines.push(blankRow);
    for (const raw of cell.lines) {
        const line = fitBar(raw, contentW);
        lines.push(BOX.v + " ".repeat(PAD_X) + padLine(line, contentW) + " ".repeat(PAD_X) + BOX.v);
    }
    lines.push(blankRow);
    lines.push(BOX.bl + BOX.h.repeat(innerW) + BOX.br);
    return lines;
}
function blankCardRow(innerW) {
    return BOX.v + " ".repeat(innerW) + BOX.v;
}
// Pad the shorter card with empty interior rows before its footer.
function extendCardHeight(lines, targetLen, innerW) {
    if (lines.length >= targetLen)
        return lines;
    const footer = lines[lines.length - 1];
    const prefix = lines.slice(0, -1);
    const blankRow = blankCardRow(innerW);
    const extra = targetLen - lines.length;
    return [...prefix, ...Array.from({ length: extra }, () => blankRow), footer];
}
// Place two equal-height cards side-by-side.
function joinCardRows(left, right, gutter) {
    return left.map((l, idx) => l + gutter + right[idx]);
}
function renderGrid(cells, termWidth, layout = "auto") {
    const out = [];
    let i = 0;
    // Summary always spans the full terminal width.
    if (cells[i]?.title === "Summary") {
        out.push(...renderCard(cells[i], columnInnerW(termWidth, 1)), "");
        i++;
    }
    const colCount = resolveColumnCount(termWidth, layout);
    const innerW = columnInnerW(termWidth, colCount);
    if (colCount === 1) {
        for (; i < cells.length; i++) {
            out.push(...renderCard(cells[i], innerW), "");
        }
    }
    else {
        for (; i < cells.length; i += 2) {
            const left = renderCard(cells[i], innerW);
            const right = cells[i + 1] ? renderCard(cells[i + 1], innerW) : null;
            if (right) {
                const target = Math.max(left.length, right.length);
                out.push(...joinCardRows(extendCardHeight(left, target, innerW), extendCardHeight(right, target, innerW), GUTTER), "");
            }
            else {
                out.push(...left, "");
            }
        }
    }
    return out.join("\n");
}
function configFile(name) {
    // mystatus state (config / cache / history) lives at the legacy global
    // ~/.config/opencode/ dir, not per-profile, so trend history doesn't
    // fragment when the user switches between opencode-multi profiles.
    return join(homedir(), ".config", "opencode", name);
}
// Strip // line and /* */ block comments (string-aware) so the config file
// can be self-documenting like opencode's own .jsonc files.
function stripJsonComments(input) {
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
            }
            else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
        }
        else if (ch === "/" && next === "/") {
            inLine = true;
            i++;
        }
        else if (ch === "/" && next === "*") {
            inBlock = true;
            i++;
        }
        else {
            out += ch;
        }
    }
    return out;
}
export function loadConfig() {
    try {
        const raw = readFileSync(configFile("mystatus.json"), "utf-8");
        return JSON.parse(stripJsonComments(raw));
    }
    catch {
        return {};
    }
}
// Resolve render width: explicit arg → env → live TTY → config → safe default.
// The plugin runs in a non-TTY server process, so the override path matters
// more than auto-detection.
function resolveWidth(explicit, cfg) {
    const clamp = (n) => Math.max(24, Math.min(400, Math.floor(n)));
    if (typeof explicit === "number" && explicit > 0)
        return clamp(explicit);
    const env = process.env.MYSTATUS_WIDTH ?? process.env.COLUMNS;
    if (env) {
        const n = parseInt(env, 10);
        if (Number.isFinite(n) && n > 0)
            return clamp(n);
    }
    const cols = process.stdout?.columns;
    if (typeof cols === "number" && cols > 0)
        return clamp(cols);
    if (typeof cfg.width === "number" && cfg.width > 0)
        return clamp(cfg.width);
    return DEFAULT_WIDTH;
}
const PROVIDERS = [
    { id: "anthropic", title: "Anthropic Account Quota", query: (a, ansi) => queryAnthropic(a.anthropic, ansi) },
    { id: "atlascloud", title: "AtlasCloud Coding Plan", query: (_a, ansi) => queryAtlasCloud(_a, ansi) },
    { id: "byteplus", title: "BytePlus Coding Plan", query: (_a, ansi) => queryBytePlus(_a, ansi) },
    { id: "copilot", title: "GitHub Copilot Account Quota", query: (a, ansi) => queryCopilot(a["github-copilot"], ansi) },
    { id: "google", title: "Google Account Quota", query: (_a, ansi) => queryGoogle(ansi) },
    { id: "longcat", title: "LongCat API Quota", query: (_a, ansi) => queryLongCat(ansi) },
    { id: "minimax", title: "MiniMax Token Plan", query: (a, ansi) => queryMiniMax(a["minimax-coding-plan"], ansi) },
    { id: "mistral", title: "Mistral Vibe Usage", query: (_a, ansi) => queryMistral(_a, ansi) },
    { id: "nanogpt", title: "NanoGPT Account Quota", query: (a, ansi) => queryNanoGpt(a["nano-gpt"], ansi) },
    { id: "openai", title: "OpenAI Account Quota", query: (a, ansi) => queryOpenAI(a.openai, ansi) },
    { id: "ollama", title: "Ollama Cloud", query: (_a, ansi) => queryOllama(_a, ansi) },
    { id: "opencode-go", title: "OpenCode Go+Zen Account Quota", query: (a, ansi) => queryOpenCodeGoZen(a["opencode-go"], ansi) },
    { id: "poe", title: "Poe Account Quota", query: (a, ansi) => queryPoe(a.poe, ansi) },
    { id: "qwencloud", title: "QwenCloud Token Plan", query: (_a, ansi) => queryQwenCloud(ansi) },
    { id: "stepfun", title: "StepFun Token Plan", query: (_a, ansi) => queryStepFun(ansi) },
    { id: "xai", title: "xAI/Grok", query: (a) => queryXai(a["xai-oauth"] ?? a.xai) },
    { id: "zai", title: "Z.AI Coding Plan", query: (a, ansi) => queryZai(a["zai-coding-plan"], ansi) },
];
function splitIds(s) {
    return (s ?? "")
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
}
function selectProviders(cfg, only, exclude) {
    const onlySet = only ? new Set(splitIds(only)) : null;
    const exclSet = new Set([
        ...(cfg.providers?.disabled ?? []).map((s) => s.toLowerCase()),
        ...splitIds(exclude),
    ]);
    let list = PROVIDERS.filter((p) => (!onlySet || onlySet.has(p.id)) && !exclSet.has(p.id));
    const order = cfg.providers?.order;
    if (order?.length) {
        const rank = new Map(order.map((id, i) => [id.toLowerCase(), i]));
        list = [...list].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
    }
    return list;
}
function loadCache() {
    try {
        return JSON.parse(readFileSync(configFile("mystatus-cache.json"), "utf-8"));
    }
    catch {
        return {};
    }
}
function saveCache(cache) {
    try {
        writeFileSync(configFile("mystatus-cache.json"), JSON.stringify(cache));
    }
    catch {
        /* best-effort */
    }
}
function withDeadline(p, ms) {
    return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`exceeded ${ms / 1000}s deadline`)), ms)),
    ]);
}
function noteCards(result, note) {
    if (!result.cards)
        return result;
    return { ...result, cards: result.cards.map((c) => ({ ...c, note: c.note ?? note })) };
}
// Run one provider with a hard deadline; on failure fall back to a cached
// snapshot (annotated). Successful results refresh the cache.
async function runProvider(p, auth, ansi, cache, ttlMs, fresh, deadlineMs) {
    const cached = cache[p.id];
    const ageNote = (ts) => `cached${formatCachedAgeMinutes(ts)}`;
    if (!fresh && ttlMs > 0 && cached && Date.now() - cached.ts < ttlMs) {
        return { title: p.title, result: noteCards(cached.result, ageNote(cached.ts)) };
    }
    try {
        const result = await withDeadline(p.query(auth, ansi), deadlineMs);
        if (result === null)
            return { title: p.title, result: null };
        if (result.success && result.cards) {
            cache[p.id] = { ts: Date.now(), result };
            return { title: p.title, result };
        }
        // Live attempt errored → fall back to a previous good snapshot if we have one.
        if (cached?.result.success) {
            return { title: p.title, result: noteCards(cached.result, ageNote(cached.ts)) };
        }
        return { title: p.title, result };
    }
    catch (err) {
        if (cached?.result.success) {
            return { title: p.title, result: noteCards(cached.result, ageNote(cached.ts)) };
        }
        return {
            title: p.title,
            result: { success: false, error: err instanceof Error ? err.message : String(err) },
        };
    }
}
function loadHistory() {
    try {
        const h = JSON.parse(readFileSync(configFile("mystatus-history.json"), "utf-8"));
        if (h && Array.isArray(h.snapshots))
            return h;
    }
    catch {
        /* no history yet */
    }
    return { version: 1, snapshots: [] };
}
function saveHistory(h) {
    try {
        writeFileSync(configFile("mystatus-history.json"), JSON.stringify(h));
    }
    catch {
        /* best-effort */
    }
}
// Ramp deliberately excludes █ (\u2588) and ░ (\u2591) so the renderer's
// progress-bar rescaler (fitBar) never mistakes a sparkline for a bar.
const SPARK = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587";
function sparkline(values, ansi = false) {
    return values
        .map((v) => {
        const idx = Math.round((Math.max(0, Math.min(100, v)) / 100) * 6);
        const char = SPARK[Math.max(0, Math.min(6, idx))];
        if (!ansi)
            return char;
        const color = v >= 50 ? ANSI_GREEN : v >= 25 ? ANSI_YELLOW : ANSI_RED;
        return `${color}${char}${ANSI_RESET}`;
    })
        .join("");
}
function buildSeries(h) {
    const map = new Map();
    for (const snap of h.snapshots) {
        for (const [k, v] of Object.entries(snap.values)) {
            const arr = map.get(k);
            if (arr)
                arr.push({ ts: snap.ts, value: v });
            else
                map.set(k, [{ ts: snap.ts, value: v }]);
        }
    }
    return map;
}
function makeTrendFn(series, mode, ansi, now) {
    if (mode === "off")
        return () => null;
    return (cellTitle, label, remaining, resetMs) => {
        if (!label)
            return null;
        const hist = series.get(`${cellTitle}::${label}`) ?? [];
        const recent = [...hist.map((p) => p.value), remaining].slice(-10);
        const spark = recent.length >= 2 ? sparkline(recent, ansi) : "";
        const parts = [];
        if (hist.length > 0) {
            const prev = hist[hist.length - 1];
            const delta = remaining - prev.value;
            const ageMs = now - prev.ts;
            const ageStr = mode === "full" ? `/${formatDuration(Math.floor(ageMs / 1000))}` : "";
            if (delta > 5)
                parts.push("\u2191 reset");
            else if (delta >= 1)
                parts.push(`\u25b2${delta}%${ageStr}`);
            else if (delta <= -1)
                parts.push(`\u25bc${Math.abs(delta)}%${ageStr}`);
            else
                parts.push("\u2192 0%");
            if (spark)
                parts.push(spark);
            if (mode === "full" && delta < 0 && ageMs > 0) {
                const ratePerMs = (prev.value - remaining) / ageMs; // %/ms
                if (ratePerMs > 0) {
                    const msToEmpty = remaining / ratePerMs;
                    if (resetMs === undefined || msToEmpty < resetMs) {
                        parts.push(`~${formatDuration(Math.floor(msToEmpty / 1000))} to empty`);
                    }
                }
            }
        }
        else if (spark) {
            parts.push(spark);
        }
        if (parts.length === 0)
            return null;
        const text = `   ${parts.join(" ")}`;
        return text;
    };
}
function recordSnapshot(history, metrics, cfg, now) {
    const minIntervalMs = (cfg.historyMinIntervalSec ?? 60) * 1000;
    const last = history.snapshots[history.snapshots.length - 1];
    if (last && now - last.ts < minIntervalMs)
        return;
    const values = {};
    for (const m of metrics)
        values[`${m.cellTitle}::${m.label}`] = m.remaining;
    if (Object.keys(values).length === 0)
        return;
    history.snapshots.push({ ts: now, values });
    const max = Math.max(2, cfg.historyMax ?? 60);
    if (history.snapshots.length > max)
        history.snapshots = history.snapshots.slice(-max);
    saveHistory(history);
}
// ============================================================
// Summary card + sorting
// ============================================================
function buildSummaryCell(cells, metrics, threshold, ansi) {
    let green = 0;
    let yellow = 0;
    let red = 0;
    for (const cell of cells) {
        const min = cellMinRemaining(cell);
        if (min > 100)
            continue;
        if (min >= 50)
            green++;
        else if (min >= threshold)
            yellow++;
        else
            red++;
    }
    let lowest;
    for (const m of metrics)
        if (!lowest || m.remaining < lowest.remaining)
            lowest = m;
    let soonest;
    for (const m of metrics) {
        if (typeof m.resetMs === "number" && (!soonest || (soonest.resetMs ?? Infinity) > m.resetMs)) {
            soonest = m;
        }
    }
    const header = [
        `Accounts:       ${cells.length}   \ud83d\udfe9 ${green}  \ud83d\udfe8 ${yellow}  \ud83d\udfe7 ${red}`,
    ];
    if (lowest) {
        header.push(`Lowest:         ${lowest.cellTitle} \u00b7 ${lowest.label}  ${lowest.remaining}%`);
    }
    if (soonest && typeof soonest.resetMs === "number") {
        header.push(`Soonest reset:  ${soonest.cellTitle} \u00b7 ${soonest.label}  ${formatDuration(Math.floor(soonest.resetMs / 1000))}`);
    }
    return cardToCell({ header }, "Summary", ansi);
}
function sortCells(cells, mode) {
    if (mode === "name") {
        cells.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    }
    else if (mode === "reset") {
        cells.sort((a, b) => (cellSoonestReset(a) ?? Infinity) - (cellSoonestReset(b) ?? Infinity));
    }
    else {
        cells.sort((a, b) => {
            const ra = cellMinRemaining(a);
            const rb = cellMinRemaining(b);
            const na = ra > 100 ? 101 : ra;
            const nb = rb > 100 ? 101 : rb;
            if (na !== nb)
                return na - nb;
            const sa = cellSoonestReset(a) ?? Infinity;
            const sb = cellSoonestReset(b) ?? Infinity;
            if (sa !== sb)
                return sa - sb;
            return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        });
    }
}
function prepareStatusView(snapshot, args, opts = {}) {
    const recordHistory = opts.recordHistory !== false;
    const now = Date.now();
    const cfg = loadConfig();
    if (snapshot.authError)
        return { error: snapshot.authError };
    const format = args.format ?? "ansi";
    const isJson = format === "json";
    const useAnsi = !isJson;
    const threshold = args.threshold ?? 25;
    const sortMode = (args.sort ?? cfg.sort ?? "urgency");
    const trendMode = (isJson ? "off" : (args.trend ?? cfg.trend ?? "compact"));
    const history = loadHistory();
    const trend = makeTrendFn(buildSeries(history), trendMode, useAnsi, now);
    const cells = [];
    const errors = [];
    for (const { title, result } of snapshot.ran) {
        collect(result, title, cells, errors, useAnsi, trend);
    }
    if (cells.length === 0) {
        return {
            error: errors.length
                ? `\u274c Failed to query:\n${errors.join("\n\n")}`
                : "No accounts found.",
        };
    }
    const metrics = gatherMetrics(cells);
    if (recordHistory)
        recordSnapshot(history, metrics, cfg, now);
    const alerts = extractAlerts(cells, threshold);
    sortCells(cells, sortMode);
    return { cells, errors, metrics, alerts, threshold, sortMode };
}
/** Build structured view data for the live TUI dashboard. */
export function buildMyStatusViewModel(snapshot, args, opts = {}) {
    const prepared = prepareStatusView(snapshot, args, opts);
    if ("error" in prepared)
        return prepared;
    const { cells, errors, metrics, alerts, threshold } = prepared;
    let green = 0;
    let yellow = 0;
    let red = 0;
    for (const cell of cells) {
        const min = cellMinRemaining(cell);
        if (min > 100)
            continue;
        if (min >= 50)
            green++;
        else if (min >= threshold)
            yellow++;
        else
            red++;
    }
    let lowest;
    for (const m of metrics)
        if (!lowest || m.remaining < lowest.remaining)
            lowest = m;
    let soonest;
    for (const m of metrics) {
        if (typeof m.resetMs === "number" && (!soonest || (soonest.resetMs ?? Infinity) > m.resetMs)) {
            soonest = m;
        }
    }
    const providers = cells.map((cell) => {
        let note;
        for (const line of cell.lines) {
            const plain = line.replace(ANSI_RE, "");
            if (plain.startsWith("cached")) {
                note = plain;
                break;
            }
        }
        return {
            name: cell.title,
            minRemaining: cellMinRemaining(cell),
            soonestResetMs: cellSoonestReset(cell),
            windows: (cell.metrics ?? []).map((m) => ({
                label: m.label,
                remaining: m.remaining,
                resetMs: m.resetMs,
            })),
            note,
        };
    });
    return {
        summary: {
            accounts: cells.length,
            green,
            yellow,
            red,
            lowest: lowest
                ? { provider: lowest.cellTitle, label: lowest.label, remaining: lowest.remaining }
                : undefined,
            soonest: soonest && typeof soonest.resetMs === "number"
                ? { provider: soonest.cellTitle, label: soonest.label, resetMs: soonest.resetMs }
                : undefined,
        },
        providers,
        errors,
        alerts,
        threshold,
    };
}
export async function queryMyStatus(args) {
    const cfg = loadConfig();
    const format = args.format ?? "ansi";
    const isJson = format === "json";
    const useAnsi = !isJson;
    const cacheTtlMs = Math.max(0, cfg.cacheTtlSec ?? 0) * 1000;
    const fresh = args.fresh === true;
    const auth = await loadAuthMerged();
    const authMissing = Object.keys(auth).length === 0;
    const providers = selectProviders(cfg, args.only, args.exclude);
    const cache = loadCache();
    const ran = await Promise.all(providers.map((p) => runProvider(p, auth, useAnsi, cache, cacheTtlMs, fresh, 15_000)));
    saveCache(cache);
    // Local/dashboard providers (including Antigravity Tools) do not require an
    // OpenCode auth.json. Preserve the old guidance only when every selected
    // provider was skipped specifically because no native auth was available.
    if (authMissing && ran.every(({ result }) => result === null)) {
        const tried = candidateDirs("data").map((d) => join(d, "auth.json"));
        return {
            ran,
            fetchedAt: Date.now(),
            authError: `\u274c No auth.json found in any opencode profile.\nLooked at: ${tried.join(", ")}`,
        };
    }
    return { ran, fetchedAt: Date.now() };
}
export function formatMyStatus(snapshot, args, opts = {}) {
    const cfg = loadConfig();
    const prepared = prepareStatusView(snapshot, args, opts);
    if ("error" in prepared)
        return prepared.error;
    const format = args.format ?? "ansi";
    const isJson = format === "json";
    const useAnsi = !isJson;
    const termWidth = resolveWidth(args.width, cfg);
    const layoutMode = resolveLayout(args.layout, cfg);
    const showSummary = (args.summary ?? cfg.summary ?? true) && !isJson;
    const { cells, errors, metrics, alerts, threshold } = prepared;
    if (isJson) {
        return cellsToJson(cells, alerts, errors);
    }
    const renderCells = [...cells];
    if (showSummary)
        renderCells.unshift(buildSummaryCell(cells, metrics, threshold, useAnsi));
    let output = renderGrid(renderCells, termWidth, layoutMode).trimEnd();
    if (alerts.length > 0) {
        if (useAnsi) {
            output += `\n\n${ANSI_BOLD}${ANSI_RED}\u26a0\ufe0f Low quota alerts:${ANSI_RESET}`;
            for (const alert of alerts)
                output += `\n${ANSI_RED}  \u2022 ${alert}${ANSI_RESET}`;
        }
        else {
            output += `\n\n\u26a0\ufe0f Low quota alerts:`;
            for (const alert of alerts)
                output += `\n  \u2022 ${alert}`;
        }
    }
    if (errors.length) {
        output += `\n\n\u274c Failed to query:\n${errors.join("\n\n")}`;
    }
    return output;
}
async function runMyStatus(args) {
    const snapshot = await queryMyStatus(args);
    return formatMyStatus(snapshot, args);
}
// ============================================================
// Plugin entry point
// ============================================================
export const MyStatusPlugin = async () => ({
    tool: {
        mystatus: tool({
            description: "Query quota usage for all configured AI platforms. Returns remaining quota, usage stats, and reset countdowns. Supports OpenAI, Anthropic, Google (Antigravity Tools quota + proxy token stats, with auth-plugin fallback), GitHub Copilot, OpenCode Go+Zen, Ollama Cloud, LongCat API, Poe, Z.AI (GLM Coding Plan), xAI/Grok, MiniMax Token Plan, NanoGPT, StepFun Token Plan, QwenCloud Token Plan, Mistral Vibe, AtlasCloud Coding Plan, and BytePlus Coding Plan. Output is a responsive grid of provider cards (two columns when the terminal is wide enough), sorted by urgency, with a full-width summary card and usage trends. Pass `width` with the user's terminal column count (or set MYSTATUS_WIDTH / a width in ~/.config/opencode/mystatus.json) so cards size to the terminal and never wrap. Optional args: layout (auto|single|double), sort (urgency|name|reset), summary (bool), trend (off|compact|full), only/exclude (comma provider ids: anthropic,atlascloud,byteplus,copilot,google,longcat,minimax,mistral,nanogpt,ollama,openai,opencode-go,poe,qwencloud,stepfun,xai,zai), fresh (bool), threshold (number), format (ansi|json).",
            args: {
                format: tool.schema.string().optional(),
                threshold: tool.schema.number().optional(),
                width: tool.schema.number().optional(),
                layout: tool.schema.string().optional(),
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
