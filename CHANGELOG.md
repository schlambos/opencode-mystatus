# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Compact one-shot view (new default)** — the `mystatus` / `usage` output and the OpenCode tool card now render one row per limit (status · label · bar · % · reset countdown, plus a delta + sparkline only when the limit actually moved). Providers with an exhausted, low, or under-50% limit get a card, most urgent first; providers whose every limit is at or above 50% collapse into one row each under **All clear**. The summary reports exhausted / low / under-50% / ok counts and the soonest recovery of a constrained limit, failures collapse to one line each, card titles use short uniform names (Anthropic, OpenAI, Google · account, Muse, Grok …), "Account/Plan/Source" header lines fold into the title and one meta line, and raw ISO timestamps in detail text become relative ("in 1h 48m"). Detail lines are hidden on full windows. Two columns are used from ~110 columns. Display names are presentation only — trend history, hidden-provider settings, JSON output, the live TUI, and the desktop app are unchanged. `"view": "classic"` in `mystatus.json` restores the previous card grid.

- **Meta Muse Code** — new `muse` provider for the opencode-muse plugin's Muse Code subscription (and the `muse` CLI login). Shows the rolling 5-hour and weekly usage windows with reset times, the plan tier, and subscription/payment warnings. Muse's only usage source is `POST api.meta.ai/muse-code/key`, which mints a fresh 24-hour key per call (verified: existing keys stay valid), so live checks are throttled to one per 15 minutes through a new per-provider `minIntervalMs` that `fresh` does not bypass.
- **Claude Code login for Anthropic** — when OpenCode has no `anthropic` credential (e.g. `@openchamber/opencode-claude`, which delegates auth to the Claude Code CLI), the Anthropic card reads Claude Code's login from the macOS keychain (`Claude Code-credentials`) or `~/.claude/.credentials.json`. The token is never refreshed (Claude Code rotates refresh tokens). The card now also shows the real account email, plan (e.g. "Claude Team (Max 5x)"), and organization from `/api/oauth/profile` instead of a fixed "Claude Pro/Max".
- **Codex CLI fallback for OpenAI** — see Fixed below.
- **Antigravity proxies declared in `opencode.json`** — custom providers whose id or name contains "antigravity" (V2 `providers.<id>.settings.baseURL/apiKey`, V1 `provider.<id>.options`) are tried as Antigravity Tools endpoints after the auto-discovered local instance.

- **OpenAI named usage quotas** — the OpenAI provider now parses every entry in the current `additional_rate_limits` response instead of displaying only the legacy primary/secondary Codex bucket. Independent named limits such as GPT-5.3-Codex-Spark render with their own weekly/session windows, reset times, trend history, sorting, and low-quota alerts; future backend-named limits are picked up automatically.
- **Anthropic structured limits and Fable** — the Anthropic provider now prefers the current `limits[]` response, including scoped model and surface quotas such as the weekly Fable limit. Older fixed fields remain a dynamic fallback, so both old and new Claude usage schemas continue to work.
- **Antigravity Tools API integration** — the existing `google` provider now auto-discovers a local Antigravity Tools install through `~/.antigravity_tools/gui_config.json` and prefers its authenticated read-only management API over direct Google OAuth. It renders each enabled account as its own provider card with Gemini and Claude/GPT 5-hour + weekly quota groups, reset times, current/proxy-disabled state, one-week per-account token usage, aggregate input/output/cache/request totals, and top proxy models. The legacy auth-plugin fallback is split into one card per account as well. Custom instances can use `ANTIGRAVITY_TOOLS_BASE_URL`, `ANTIGRAVITY_TOOLS_API_KEY`, `ANTIGRAVITY_TOOLS_ADMIN_PASSWORD`, or the equivalent `mystatus.json` settings; `/v1` and `/api` base-URL suffixes are normalized automatically. Locally discovered credentials are restricted to loopback origins, management API failures fall back to `antigravity-accounts.json`, and older Antigravity Tools versions without grouped quota data fall back to conservative per-model family aggregation.
- **LongCat API** — the plugin now shows LongCat platform token quota by reading browser session cookies from `~/.config/opencode/longcat-cookies.json` (`passport_token_key` → `passportToken`, `long_cat_region_key` → `region`) and calling `longcat.chat/api/lc-platform/v1/tokenUsage`, `/api/v1/user-current`, and `/api/lc-platform/v1/query-active-apiKeys`. Displays account email, active API key count, **free quota** (the pool that blocks `api.longcat.chat` inference when empty), **total tokens** (including fuel packages), and fuel-package expiry. Inference API keys (`ak_…` in `opencode.json`) cannot read quota. Provider ID: `longcat`.
- **Ollama Cloud** — the plugin now shows Ollama Cloud Pro/Max session and weekly GPU-time windows by scraping `ollama.com/settings` SSR with browser session cookies from `~/.config/opencode/ollama-cookies.json`, enriched with the subscription renewal date from `/settings/billing`. Inference API keys (`auth.json` → `ollama-cloud`) cannot read account quota. Provider ID: `ollama`.
- **QwenCloud Token Plan** — the plugin now shows QwenCloud (Aliyun) Token Plan Team Edition usage by reading browser session cookies from `~/.config/opencode/qwencloud-cookies.json`, fetching the CSRF `SEC_TOKEN` from the homepage HTML, and calling `home.qwencloud.com/data/api.json` (`GetSeatSubscriptionSummary` + `CheckTokenPlanAutoRenewal`). Displays plan name, seat count, credit quota window (SurplusValue / TotalValue with percent bar), cycle dates, and auto-renewal status. To configure: log into home.qwencloud.com, copy `login_qwencloud_ticket`, `login_aliyunid_pk`, `isg`, and optionally `login_ESM_account_ticket` cookies, and save as JSON. Provider ID: `qwencloud`.
- **StepFun Token Plan** — the plugin now shows StepFun usage and plan status by reading Oasis browser session cookies from `~/.config/opencode/stepfun-cookies.json` and calling the `platform.stepfun.ai` dashboard API (`QueryStepPlanRateLimit` and `GetStepPlanStatus`). Displays plan name (Plus/Pro/etc.), price, auto-renewal, 5-hour rolling and weekly quota windows with reset timers, and supported model list. To configure: log into platform.stepfun.ai, copy `Oasis-Token`, `Oasis-Webid`, and `__Secure-next-auth.session-token` cookies, and save as JSON. Provider ID: `stepfun`.
- **xAI/Grok weekly usage** — the xAI card now represents SuperGrok as one shared weekly pool across API, Build, Chat, Imagine, and Voice, with an explicit weekly label/reset, per-product usage, separate monthly billing reference, and extra-usage credits. It reads the consumer (`grok-build` referrer) token from `~/.grok/auth.json` via `cli-chat-proxy.grok.com/v1/billing?format=credits`, auto-refreshes through `auth.x.ai/oauth2/token`, and falls back to OpenCode's `xai` / `xai-oauth` dev token. Weekly-only providers now appear on the TUI's Weekly pane as well as Current.

### Changed

- **Provider-wide quota contract audit** — reviewed all 17 integrations against live authenticated responses where configured and current provider contracts/dashboard clients elsewhere. Parsers now prefer provider-reported windows, scopes, units, and reset periods; optional or retired fields no longer create invented quota rows.
- **GitHub Copilot AI credits** — PAT mode now queries the current `ai_credit/usage` report and uses current individual Pro / Pro+ / Max monthly AI-credit allowances. Business and Enterprise usage is organization-pooled, so those reports show consumed credits without fabricating a per-user remainder. The legacy premium-request API remains a separate fallback, and OAuth mode dynamically renders every returned `quota_snapshots` entry.
- **AtlasCloud dual limits and stacked packs** — current monthly plans now show their independent weekly cap and full-cycle total using the console's `weekly_*`, `total_quota`, and `used_quota` fields. Every active pay-as-you-go pack is rendered with its own balance/expiry; legacy daily-reset plans remain compatible.
- **OpenAI and Anthropic enrichments** — OpenAI now includes code-review limits, reset-credit availability, approximate local/cloud message ranges, and spend-control state. Anthropic now consumes the canonical `spend` object for usage-credit balances and extra-usage caps while retaining legacy `extra_usage` compatibility.
- **Schema-compatible quota reporting** — NanoGPT supports both documented daily/monthly operation pools and newer weekly-token/daily-image pools; Z.AI distinguishes monthly MCP/tool-call limits; Mistral is labeled as a monthly Vibe budget; MiniMax follows the current unified 5-hour/weekly pool while accepting legacy named buckets; Grok derives its period label/reset from `currentPeriod` and retains zero-use products in the breakdown.

### Fixed

- **OpenCode V2 credential store** — OpenCode V2 no longer writes `auth.json`; connections live in the `credential` table of `~/.local/share/opencode/opencode.db`. mystatus only read `auth.json`, so on V2 every auth-based provider was reported as unconfigured and the run ended with "No auth.json found". Credentials are now read from `opencode.db` (read-only, via `bun:sqlite`, `node:sqlite`, or the `sqlite3` CLI, across opencode-multi profiles), preferring each integration's active connection and merged with any legacy `auth.json`. V2 `{type:"key"}` entries are normalized to the `auth.json` shape.
- **Google accounts from opencode-antigravity-auth on V2** — the account filter only trusted refresh tokens found in `auth.json`, so on V2 every Antigravity account except ones mirrored across profiles was dropped. All V2 `google` connections now count. The per-account fallback also queries accounts in parallel instead of one after another.
- **OpenAI on OpenCode V2** — V2's default "Sign in with ChatGPT" (`chatgpt-token-sharing`, `oaiapp_…` client) tokens are rejected by `chatgpt.com/backend-api/wham/usage` (`401 no_matching_rule`), and OpenAI has no usage route for them. mystatus now skips those tokens and uses a Codex-client token instead: OpenCode's legacy "Codex browser" login, or the Codex CLI's `~/.codex/auth.json` (read-only). With only a token-sharing login, the card explains how to enable usage (`codex login`).
- **Gemini Argon as its own quota line** — `gemini-4-argon-{low,medium,high}` report a separate (weekly) pool in `retrieveUserQuota`, but were classified into "Gemini Pro" and min-aggregated with `gemini-2.5-pro`, so an exhausted Argon pool showed as "Gemini Pro 0%" while 2.5 Pro was untouched. The direct-Google path now renders a **Gemini Argon** window per account (only for accounts entitled to Argon), and Gemini Pro reflects its own pool again. The Antigravity Tools path already reports Argon as its own quota group.
- **Synthetic schema** — `/v2/quotas` now returns `planWeeklyLimit` (percent remaining + regeneration ticks) and `search.hourly`; both are rendered, and the subscription window shows its reset countdown.
- **CLI exit delay** — the per-provider deadline timer was never cleared, so one-shot `mystatus` runs waited the full 15 s before exiting.
- **Stale `dist/`** — rebuilt so the OpenCode V2 adapter (which imports `dist/plugin/mystatus.js`) matches the source.

- **xAI/Grok unified billing empty card** — SuperGrok accounts with `isUnifiedBillingUser` no longer return `creditUsagePercent` / `weeklyUsagePercent` / `productUsage` from `cli-chat-proxy.grok.com/v1/billing?format=credits`. mystatus required those fields and only attached the monthly ledger when a weekly window already existed, so the card showed auth with no usage bar. It now falls back to the default `/v1/billing` ledger (`used` / `monthlyLimit` or `weeklyLimit`) for the bar percentage, labels/resets from the credits `currentPeriod` (usually weekly) so the card does not say “Monthly” while counting down a ~5-day SuperGrok window, and still keeps weekly percent + product breakdown when present.
- **Google/Antigravity quota misreporting** — the live-quota path (`cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`) matched a hard-coded list of model keys (`gemini-3.1-pro-high`, `gemini-3-pro-image`, `claude-opus-4-6-thinking`, …). Google recycles those key slots and remaps the served model via `displayName` (e.g. the key `gemini-2.5-flash` currently serves "Gemini 3.1 Flash Lite", and `gemini-pro-agent` serves "Gemini 3.1 Pro (High)"), and `gemini-3-pro-image` no longer exists — so windows were silently dropped or attributed to the wrong family. The live path now classifies every returned model by `key + displayName` into the same `gemini-pro` / `gemini-flash` / `claude` families the auth plugin caches, aggregating the conservative (minimum) remaining fraction and earliest reset per family. This makes the live and cached paths consistent and resilient to Google's frequent model renames. (Confirmed against the live API: pro=3 / flash=9 / claude=2 models, matching the cached snapshot.)
- **NanoGPT multi-auth status** — `mystatus` now reads both native OpenCode `auth.json` `nano-gpt` credentials and `opencode-nanogpt-multi-auth`'s `~/.local/share/opencode/nanogpt-keys.json` pool. Plugin-managed keys render as separate labeled NanoGPT cards, dummy loader keys are ignored, and duplicate native/plugin keys are de-duplicated.
- **Quota math and timestamps** — NanoGPT derives a missing remainder from `limit - used`; Poe uses plan-only points for monthly percentages instead of the total balance that includes add-ons; MiniMax no longer mistakes a weekly duration in seconds for milliseconds; StepFun skips absent optional windows; provider epoch timestamps are normalized across seconds, milliseconds, and microseconds.
- **Grok period separation** — the SuperGrok bar now follows the provider's weekly `/usage` percentage, while the default endpoint's monthly dollar ledger is labeled as a separate reference rather than an absolute weekly allowance.

## [3.1.0] - 2026-06-04

### Added

- **Standalone CLI** — `bin/mystatus-cli.ts` imports the plugin directly via bun and exposes all tool args (`--only`, `--format`, `--trend`, `--fresh`, etc.) as CLI flags. Install with `./bin/mystatus --install` or copy the files to `~/.local/bin/`.
- **`usage` alias** — symlinked to `mystatus` for a shorter terminal command.

### Changed

- **Trend readability** — sparkline characters are now ANSI color-coded per value (green ≥50%, yellow ≥25%, red <25%), making consumption direction scannable at a glance. The "trend" prefix is removed and the `·` separator dropped for a compact format (`▼2%/4m ▅▄▄  ~1h 40m to empty`). No more `ANSI_DIM` — full-weight text.
- **README** — updated example output, new "Standalone CLI" section with install instructions.

### Fixed

- Projection text no longer includes `(before reset)` — the suffix was routinely truncated and added little information.

## [3.0.0] - 2026-06-03

### Added

- **NanoGPT** provider — USD/Nano balance via `/api/check-balance` plus subscription allowances (weekly input tokens, daily images, renewal date) via `/api/subscription/v1/usage`.
- **Summary card** — account tally (🟩/🟨/🟧), lowest window, and soonest reset, rendered at the top.
- **Usage trends** — per-window history (`~/.config/opencode/mystatus-history.json`) drives a trend line under each bar: delta, sparkline, and a "~Xh to empty (before reset)" projection. Configurable via `trend: off | compact | full`.
- **Urgency sorting** — cards order by lowest remaining first by default; also `name` and `reset` modes (`sort`).
- **Cache fallback & resilience** — successful results are cached and reused when a live fetch fails (`mystatus-cache.json`); HTTP requests now retry on 429/5xx with backoff, and each provider runs under a hard deadline so one slow API can't stall the report.
- **Configuration file** — `~/.config/opencode/mystatus.json` (JSONC, comments allowed) for persistent defaults; every option is also a per-call tool arg. See `mystatus.example.json`.
- **New tool args** — `width`, `sort`, `summary`, `trend`, `only`, `exclude`, `fresh`.
- **`/usage` command** alias alongside `/mystatus`.
- **xAI/Grok** now reports a token-expiry countdown.

### Changed

- **Responsive single-column layout** — providers render as full-width cards that size to the terminal (or `width` / `MYSTATUS_WIDTH` / `COLUMNS`) and never wrap, replacing the fixed two-column grid. Progress bars scale to the card.
- **Structured rendering** — providers now emit a typed `ProviderCard` model (header / windows / footer) consumed by a single renderer, making metrics, sorting, summary, and trends exact rather than parsed from text.
- **Provider registry** — providers are declared in one array; filtering and ordering build on it.

### Fixed

- **Z.AI "Invalid Date"** — a missing/empty `nextResetTime` no longer throws (`new Date(undefined).toISOString()`) and kills the card; reset is handled safely.
- **Trend sparklines** are no longer mistaken for progress bars and stretched to full width (the ramp no longer uses the █ glyph).

## [2.0.0] - 2026-05-30

### Added

- **Anthropic (Claude.ai)** — queries `api.anthropic.com/api/oauth/usage` via the Claude Code OAuth client, with automatic token refresh. Shows 5-hour and 7-day rolling windows for Claude Pro/Max.
- **OpenCode Go** — two modes: (a) simple API probe (`GET /models`) when only an API key is available, (b) full dashboard scraping (parses SolidJS SSR hydration output for rolling/weekly/monthly quota windows) when a workspace ID + browser auth cookie are configured.
- **Poe** — queries `api.poe.com/usage/current_balance` with a bearer token resolved from auth.json, `POE_API_KEY` env var, or `~/.config/opencode/poe-api-key.json`. Shows monthly points, daily grants, and USD equivalent.
- `fetchTimeout` utility with `AbortController` — all HTTP requests have a 10-second timeout to prevent hanging on slow responses.
- **Copilot PAT fallback** — reads a fine-grained PAT from `~/.config/opencode/copilot-quota-token.json` and calls the GitHub public billing API as a primary auth path.

### Changed

- **Google path fixed**: always resolves to `~/.config/opencode/` regardless of `OS` — upstream incorrectly used `APPDATA` on Windows.
- **Google cached-quota fallback**: reads `cachedQuota` from `antigravity-accounts.json` as primary source when the live API call fails, with age indicator.
- **Google model keys updated**: `gemini-3.1-pro-high`/`gemini-3.1-pro-low` regrouped as `G3 Pro`, `claude-opus-4-6-thinking` with `claude-sonnet-4-6` alt.
- **Copilot rewritten**: multi-strategy auth (PAT → direct OAuth → token exchange), with better error messages guiding users to the PAT workaround.
- **Single-file structure**: all platform modules inlined into `plugin/mystatus.ts` — removes `plugin/lib/` directory, `eslint.config.js`, `.prettierignore`, and `README.zh-CN.md`.
- **Removed Zhipu AI and Z.ai** support (no longer relevant with Anthropic/OpenCode Go additions).
- **package.json**: bumped to v2.0.0, updated descriptions, keywords, repo URLs, removed lint/format devDependencies and scripts.
- **README.md**: rewritten for new platforms, simplified installation, per-platform sections describing auth flows.

### Fixed

- OpenAI token expiry detection — returns a clear error message instead of failing silently.
- All API calls now apply a 10-second timeout (was unbounded in upstream).

### Documentation

- Updated installation instructions in `README.md` and `README.zh-CN.md` to remove version constraints, allowing for automatic updates.

## [1.2.1] - 2026-01-14

### Fixed

- Remove unused `maskString` import in `copilot.ts` to fix lint error

## [1.2.0] - 2026-01-14

### Added

- Support for GitHub Copilot account quota tracking (Premium requests)
- New `copilot.ts` module for GitHub internal API integration
- Updated `README.md` and `README.zh-CN.md` with Copilot documentation

## [1.0.1] - 2026-01-11

### Fixed

- Include `command/` directory in npm package for slash command support

## [1.0.0] - 2026-01-11

### Added

- Initial release
- Query OpenAI account quota (Plus/Team/Pro)
- Query Zhipu AI account quota (Coding Plan)
- Query Google Cloud account quota (Antigravity)
- Visual progress bars for quota display
- Multi-language support (Chinese/English)
- API key masking for security
