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
import { type Plugin } from "@opencode-ai/plugin";
interface QuotaWindow {
    label: string;
    remaining: number;
    resetAt?: string;
    resetInSec?: number;
    resetText?: string;
    suffix?: string;
    detail?: string[];
    extra?: string[];
    warn?: string;
    sectionHeader?: string;
    trendKey?: string;
}
interface ProviderCard {
    subtitle?: string;
    note?: string;
    header?: string[];
    windows?: QuotaWindow[];
    footer?: string[];
}
interface QueryResult {
    success: boolean;
    cards?: ProviderCard[];
    output?: string;
    error?: string;
}
type LayoutMode = "auto" | "single" | "double";
interface MyStatusConfig {
    width?: number;
    layout?: LayoutMode;
    sort?: "urgency" | "name" | "reset";
    summary?: boolean;
    trend?: "off" | "compact" | "full";
    cacheTtlSec?: number;
    historyMax?: number;
    historyMinIntervalSec?: number;
    watchIntervalSec?: number;
    uiRefreshSec?: number;
    providers?: {
        disabled?: string[];
        order?: string[];
    };
    google?: {
        excludeEmails?: string[];
    };
    antigravityTools?: {
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        adminPassword?: string;
        usageHours?: number;
        includeUsage?: boolean;
    };
}
export declare function loadConfig(): MyStatusConfig;
export interface RanProvider {
    title: string;
    result: QueryResult | null;
}
export interface MyStatusArgs {
    format?: string;
    threshold?: number;
    width?: number;
    layout?: string;
    sort?: string;
    summary?: boolean;
    trend?: string;
    only?: string;
    exclude?: string;
    fresh?: boolean;
}
export interface MyStatusSnapshot {
    ran: RanProvider[];
    fetchedAt: number;
    authError?: string;
}
export interface FormatMyStatusOptions {
    /** When false, skip writing a history snapshot (for TUI repaint ticks). Default true. */
    recordHistory?: boolean;
}
/** Structured quota data for the live TUI (does not affect one-shot / tool output). */
export interface MyStatusViewWindow {
    label: string;
    remaining: number;
    resetMs?: number;
}
export interface MyStatusViewProvider {
    name: string;
    minRemaining: number;
    soonestResetMs?: number;
    windows: MyStatusViewWindow[];
    note?: string;
}
export interface MyStatusViewModel {
    summary: {
        accounts: number;
        green: number;
        yellow: number;
        red: number;
        lowest?: {
            provider: string;
            label: string;
            remaining: number;
        };
        soonest?: {
            provider: string;
            label: string;
            resetMs: number;
        };
    };
    providers: MyStatusViewProvider[];
    errors: string[];
    alerts: string[];
    threshold: number;
}
/** Build structured view data for the live TUI dashboard. */
export declare function buildMyStatusViewModel(snapshot: MyStatusSnapshot, args: MyStatusArgs, opts?: FormatMyStatusOptions): MyStatusViewModel | {
    error: string;
};
export declare function queryMyStatus(args: MyStatusArgs): Promise<MyStatusSnapshot>;
export declare function formatMyStatus(snapshot: MyStatusSnapshot, args: MyStatusArgs, opts?: FormatMyStatusOptions): string;
export declare const MyStatusPlugin: Plugin;
export {};
//# sourceMappingURL=mystatus.d.ts.map