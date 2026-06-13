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
import { type Plugin } from "@opencode-ai/plugin";
export declare const MyStatusPlugin: Plugin;
//# sourceMappingURL=mystatus.d.ts.map