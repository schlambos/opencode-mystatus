<h1 align="center">opencode-mystatus</h1>

<p align="center">
  <strong>Every AI quota you pay for, in one glance.</strong><br>
  A problems-first usage dashboard for <a href="https://opencode.ai">OpenCode</a> and your terminal — twenty providers, one command.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://opencode.ai"><img src="https://img.shields.io/badge/OpenCode-V2%20%2B%20V1-black.svg" alt="OpenCode V2 and V1"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg" alt="Node >= 18">
</p>

<p align="center">
  <em>Fork of <a href="https://github.com/vbgate/opencode-mystatus">vbgate/opencode-mystatus</a>. Not published to npm — install from this repo.</em>
</p>

---

ChatGPT, Claude, Gemini, Copilot, Grok, Muse, and a handful of API plans each have their own dashboard, their own reset clock, and their own way of telling you that you're out. **mystatus** reads the logins you already have — OpenCode's credential store, Claude Code, the Codex CLI, Antigravity — asks every provider how much is left, and tells you what needs attention first.

```text
/mystatus          inside OpenCode
mystatus           from any terminal
mystatus --watch   live full-screen dashboard
```

## What it looks like

```text
╭─ mystatus ───────────────────────────────────────────────────────╮
│                                                                  │
│  7 accounts · 🟥 1 exhausted · 🟧 2 low · 🟨 1 under 50%         │
│  🟩 3 ok                                                         │
│  Next recovery: Anthropic · alex@example.com                     │
│  5-hour limit 18% → resets in 1h 12m                             │
│  ❌ Failed: Z.AI                                                 │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Google · alex@example.com ──────────────────────────────────────╮
│                                                                  │
│  🟥 Gemini Argon ░░░░░░░░░░░░░░░░░░░░░░░░   0%  ↻ 4d 14h         │
│  🟩 Gemini Pro   ████████████████████████ 100%  ↻ 4h             │
│  🟩 Gemini Flash ████████████████████████ 100%  ↻ 4h             │
│  🟩 Claude       ████████████████████████ 100%  ↻ 5h             │
│  🟩 GPT-OSS      ████████████████████████ 100%  ↻ 5h             │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Anthropic · alex@example.com ───────────────────────────────────╮
│                                                                  │
│  Claude Max (Max 5x) · via Claude Code login                     │
│                                                                  │
│  🟧 5-hour limit  ████░░░░░░░░░░░░░░░░░░░░  18%  ↻ 1h 12m        │
│  🟩 7-day limit   ███████████████░░░░░░░░░  64%  ↻ 4d 4h         │
│  🟩 7-day (Fable) ████████████████████████ 100%  ↻ 4d 4h         │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Synthetic ──────────────────────────────────────────────────────╮
│                                                                  │
│  🟩 Subscription requests ██████████████████ 100%  ↻ 5h          │
│  🟧 Weekly plan limit     ███░░░░░░░░░░░░░░░  19%                │
│     Regenerates +2% per tick · next tick in 1h 48m               │
│  🟩 Search (hourly)       ██████████████████ 100%  ↻ 1h          │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Muse · alex@example.com ────────────────────────────────────────╮
│                                                                  │
│  cached (3 min ago) · Muse Code Power Usage                      │
│                                                                  │
│  🟩 5-hour limit ███████████████████████░  97%  ↻ 3h 28m         │
│  🟨 Weekly limit ███████░░░░░░░░░░░░░░░░░  30%  ↻ 3d 23h         │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ All clear (3) ──────────────────────────────────────────────────╮
│                                                                  │
│  🟩 Grok                       76% Weekly SuperGrok  ↻ 5d 2h     │
│  🟩 OpenAI · alex@example.com  91% 7-day limit       ↻ 5h        │
│  🟩 Google · sam@example.com   100%                  ↻ 2h        │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

❌ Failed to query:
  Z.AI: Z.AI API error (401)
    Re-authenticate zai-coding-plan in OpenCode.
```

- **Problems first.** Providers with an exhausted, low (< 25%), or under-50% limit get a card, most urgent first. Everything healthy collapses to one line under **All clear**.
- **One row per limit** — status · label · bar · percent · reset countdown. A trend (delta + sparkline) appears only when a limit actually moved.
- **The summary answers "when do I get it back?"** — the soonest reset of a constrained limit, plus anything that failed.
- **Fits your terminal.** One column below ~110 columns, two above; nothing wraps. Status squares (🟥 🟧 🟨 🟩) keep it readable when ANSI color is stripped.

Prefer one detailed card per provider? Set `"view": "classic"` in [`mystatus.json`](#configuration). Need data, not pictures? Use `format: json`.

## Contents

- [Quick start](#quick-start)
- [Usage](#usage)
- [Supported providers](#supported-providers)
- [Where credentials come from](#where-credentials-come-from)
- [Provider setup](#provider-setup)
- [Configuration](#configuration)
- [Live dashboard](#live-dashboard)
- [Desktop app](#desktop-app)
- [Troubleshooting](#troubleshooting)
- [Security & privacy](#security--privacy)
- [Development](#development)

## Quick start

Requires [bun](https://bun.sh) for the CLI and Node ≥ 18 / npm for the build.

```bash
git clone https://github.com/schlambos/opencode-mystatus.git ~/Repos/mystatus
cd ~/Repos/mystatus
npm ci && npm run build          # → dist/plugin/{mystatus,opencode-v2}.js
./bin/mystatus --install         # symlinks `mystatus` and `usage` into ~/.local/bin
```

Then hook it into OpenCode.

### OpenCode V2

V2 does not run V1-style plugins, so the repo ships a small adapter ([`plugin/opencode-v2.ts`](plugin/opencode-v2.ts)) that registers the same tool through the V2 API. Re-export it from a local plugin and copy the slash commands:

```bash
mkdir -p ~/.config/opencode/plugins/mystatus ~/.config/opencode/commands
printf 'export { default } from "%s/dist/plugin/opencode-v2.js";\n' "$PWD" \
  > ~/.config/opencode/plugins/mystatus/index.ts
cp command/mystatus.md command/usage.md ~/.config/opencode/commands/
```

Restart OpenCode. If your TUIs attach to a background `opencode serve` process, restart that process too — plugins load there, not in the TUI.

### OpenCode V1

Reference the built module and copy the commands:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": ["file:///absolute/path/to/opencode-mystatus/dist/plugin/mystatus.js"]
}
```

```bash
cp command/mystatus.md command/usage.md ~/.config/opencode/command/
```

### Updating

```bash
cd ~/Repos/mystatus && git pull && npm ci && npm run build
```

The CLI runs the TypeScript source directly, so it picks up changes immediately. OpenCode loads `dist/` once at startup — restart it (and any background `opencode serve`) after rebuilding.

## Usage

- **`/mystatus`** or **`/usage`** inside OpenCode, or just ask — *"how much Claude do I have left?"*
- **`mystatus`** / **`usage`** from any terminal — no OpenCode session needed.
- **`mystatus --watch`** for the [live dashboard](#live-dashboard).

```bash
mystatus                        # everything, problems first
mystatus --only anthropic,openai
mystatus --exclude poe,longcat
mystatus --fresh                # bypass the cache
mystatus --trend full           # adds time-to-empty projections (classic view)
mystatus --format json          # machine-readable
mystatus --help
```

### Options

Every option works as a tool argument, a CLI flag, or (where noted) a [config default](#configuration).

| Option | Values | Default | Description |
|---|---|---|---|
| `width` | number | auto | Render width in columns. Resolution: argument → `MYSTATUS_WIDTH` / `COLUMNS` → live TTY → config → 100 |
| `layout` | `auto` · `single` · `double` | `auto` | Force one or two columns |
| `sort` | `urgency` · `name` · `reset` | `urgency` | Card order |
| `summary` | boolean | `true` | Show the summary box |
| `trend` | `off` · `compact` · `full` | `compact` | Trend annotations from your own history (`full` adds projections in the classic view) |
| `threshold` | number | `25` | Percent below which a limit counts as **low** |
| `only` / `exclude` | comma-separated ids | — | Filter providers |
| `fresh` | boolean | `false` | Ignore the cache for this run (Muse's 15-minute throttle still applies) |
| `format` | `ansi` · `json` | `ansi` | `json` returns structured cards, metrics, issues, and health |

Provider ids: `anthropic` `atlascloud` `byteplus` `copilot` `google` `kimi` `longcat` `minimax` `mistral` `muse` `nanogpt` `ollama` `openai` `opencode-go` `poe` `qwencloud` `stepfun` `synthetic` `xai` `zai`

## Supported providers

Providers you aren't signed into are skipped silently.

| Provider | id | Credentials | What you see |
|---|---|---|---|
| **Anthropic** | `anthropic` | OpenCode `anthropic` login, else **Claude Code's login** | Every `limits[]` entry (5-hour, 7-day, scoped limits such as Fable), plan and organization, extra-usage spend/credits |
| **AtlasCloud** | `atlascloud` | Browser session cookie | Weekly + full-cycle caps, every stacked pay-go pack, cookie expiry |
| **BytePlus** | `byteplus` | Browser session cookie | Ark Coding Plan rolling / weekly / monthly windows |
| **GitHub Copilot** | `copilot` | Fine-grained PAT, else OpenCode `github-copilot` | Monthly AI credits (individual plans), pooled org usage, legacy premium requests, every quota snapshot |
| **Google (Antigravity)** | `google` | Antigravity Tools, else `opencode-antigravity-auth` accounts | Per account: **Gemini Argon**, Gemini Pro, Gemini Flash, Claude, GPT-OSS — 5-hour and weekly — plus proxy token usage when Antigravity Tools is running |
| **Kimi for Coding** | `kimi` | OpenCode `kimi-for-coding` | Weekly + rolling 5-hour windows, parallel-request limit |
| **LongCat** | `longcat` | Browser session cookie | Free quota, total tokens incl. fuel packs, fuel-pack expiry |
| **MiniMax** | `minimax` | OpenCode `minimax-coding-plan` | Unified 5-hour + weekly Token Plan pools |
| **Mistral** | `mistral` | Browser session cookie | Monthly Vibe budget per account |
| **Meta Muse Code** | `muse` | `opencode-muse` login, else `muse` CLI login | Rolling 5-hour + weekly usage, plan tier, subscription warnings |
| **NanoGPT** | `nanogpt` | OpenCode `nano-gpt` + `opencode-nanogpt-multi-auth` pool | USD/XNO balance plus every subscription pool |
| **Ollama Cloud** | `ollama` | Browser session cookie | Session + weekly GPU-time windows, renewal date |
| **OpenAI** | `openai` | OpenCode Codex-client login, else **Codex CLI login** | General, code-review, and named model limits; credits; reset credits; spend controls |
| **OpenCode Go + Zen** | `opencode-go` | Workspace cookie | Rolling/weekly/monthly quota, Zen balance and per-model spend |
| **Poe** | `poe` | OpenCode `poe`, `POE_API_KEY`, or key file | Point balance and grants; monthly % only when plan-only points are reported |
| **QwenCloud** | `qwencloud` | Browser session cookie | Token Plan credits, cycle dates, free-tier quotas |
| **StepFun** | `stepfun` | Browser session cookie | Step Plan 5-hour (and weekly, when returned) pools |
| **Synthetic** | `synthetic` | OpenCode `synthetic`, `SYNTHETIC_API_KEY`, or key file | Subscription requests, weekly plan limit with regeneration ticks, hourly search |
| **xAI / Grok** | `xai` | `grok login`, else OpenCode `xai` / `xai-oauth` | SuperGrok shared weekly pool, per-product breakdown, extra-usage credits |
| **Z.AI** | `zai` | OpenCode `zai-coding-plan` | 5-hour + weekly prompt pools, monthly MCP/tool-call limits |

**No card:** plain pay-as-you-go API keys (e.g. a Meta `meta` API key) expose no usage endpoint.

## Where credentials come from

mystatus never asks you to log in again. It reads, read-only:

| Source | Used for |
|---|---|
| **OpenCode V2 credential store** — `credential` table in `~/.local/share/opencode/opencode.db` | Every integration connected in OpenCode, including plugin-provided ones (Antigravity Google accounts, Muse). The active connection wins; inactive Google connections still count as accounts. |
| **OpenCode V1** — `~/.local/share/opencode/auth.json` | The same, for older installs. Both stores are merged. |
| **opencode-multi profiles** — `~/Library/Application Support/opencode-multi/profiles/*` | Searched alongside the default locations; duplicate accounts are de-duplicated. |
| **Claude Code login** — macOS keychain item `Claude Code-credentials`, or `~/.claude/.credentials.json` | Anthropic, when OpenCode has no `anthropic` credential (e.g. with `@openchamber/opencode-claude`, which delegates auth to Claude Code). |
| **Codex CLI login** — `~/.codex/auth.json` | OpenAI, when OpenCode's login uses ChatGPT token sharing (see [OpenAI](#provider-setup)). |
| **Antigravity Tools** — `~/.antigravity_tools/gui_config.json`, plus any `opencode.json` provider whose id or name contains "antigravity" | Google, preferred when the service is reachable. |
| **`opencode-antigravity-auth`** — `~/.config/opencode/antigravity-accounts.json` | Google fallback, queried directly against Google. |
| **Other CLIs** — `~/.grok/auth.json`, `~/.config/muse/auth.json` | Grok billing, Muse fallback. |
| **Files you add** in `~/.config/opencode/` | Cookie providers, Copilot PAT, Poe/Synthetic keys — see [Provider setup](#provider-setup). |

Tokens owned by another tool (Claude Code, Codex CLI) are **never refreshed** by mystatus, because those tools rotate their refresh tokens. If one has expired, the card tells you which command to run.

## Provider setup

Anything signed in through OpenCode, Claude Code, the Codex CLI, or Antigravity works with no setup. The sections below cover providers with extra steps or caveats.

### Providers that need a browser session

These providers have no usage API reachable with an inference key, so mystatus reads their own dashboard API using your signed-in browser session. Save the values as JSON under `~/.config/opencode/`; without the file the provider is skipped. Sessions expire — re-capture when a card stops rendering. (The [desktop app](#desktop-app) can capture these for you.)

| Provider | File | Contents |
|---|---|---|
| **AtlasCloud** | `atlas-cookies.json` | `{ "cookie": "access-token=…; …" }` (optional `"accountUuid"`) |
| **BytePlus** | `byteplus-cookies.json` | `{ "cookie": "<Cookie header from console.byteplus.com>" }` |
| **LongCat** | `longcat-cookies.json` | `{ "passportToken": "<passport_token_key>", "region": "2" }` or `{ "cookie": "…" }` — see [example](longcat-cookies.example.json) |
| **Mistral** | `mistral-cookies.json` | `{ "cookie": "csrftoken=…; …" }` or `{ "accounts": [ { "alias": "…", "cookie": "…" } ] }` |
| **Ollama** | `ollama-cookies.json` | `{ "cookie": "__Secure-session=…; …" }` |
| **OpenCode Go + Zen** | `opencode-go.json` | `{ "workspaceId": "<uuid>", "authCookie": "<opencode.ai auth cookie>" }` or `{ "accounts": [ … ] }` |
| **QwenCloud** | `qwencloud-cookies.json` | `{ "ticket": "…", "aliyunPk": "…", "isg": "…", "esmTicket": "…" }` (`esmTicket` optional) |
| **StepFun** | `stepfun-cookies.json` | `{ "oasisToken": "…", "oasisWebid": "…", "sessionToken": "…" }` |

### Provider notes

<details>
<summary><strong>Anthropic</strong> — OpenCode login or Claude Code</summary>

<br>

Uses OpenCode's `anthropic` credential when one exists (refreshing it if expired). Otherwise it reads Claude Code's own login — the macOS keychain item `Claude Code-credentials` (suffixed with a config-dir hash when `CLAUDE_CONFIG_DIR` is set), or `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json` elsewhere. That is where `@openchamber/opencode-claude` leaves authentication. mystatus does not refresh the Claude Code token; if it has expired, run `claude` once.

Usage comes from `api.anthropic.com/api/oauth/usage` and the account email, plan (e.g. *Claude Team (Max 5x)*), and organization from `/api/oauth/profile`. Every `limits[]` entry is rendered, including scoped limits such as **7-day (Fable)**; the `spend` object supplies usage-credit balance and extra-usage caps. Older fixed-field responses still work.
</details>

<details>
<summary><strong>AtlasCloud</strong> — browser session</summary>

<br>

The coding-plan key (`apikey-…`) can only call inference. Log into `console.atlascloud.ai`, copy the full `Cookie` header (at minimum `access-token=`), and save `atlas-cookies.json`. `accountUuid` is auto-resolved; set it only to pin one of several accounts. Monthly plans show independent **weekly** and **full-cycle** caps, and every active pay-as-you-go pack is listed with its own balance and expiry. The `access-token` lasts about 7 days; the card shows its expiry.
</details>

<details>
<summary><strong>GitHub Copilot</strong> — optional PAT for the most reliable numbers</summary>

<br>

1. **Fine-grained PAT (recommended).** Create a token with **Plan → Read-only** at <https://github.com/settings/tokens?type=beta> and save `~/.config/opencode/copilot-quota-token.json`:
   ```json
   { "token": "github_pat_...", "username": "YourGitHubUsername", "tier": "pro" }
   ```
   `tier` is `pro`, `pro+`, or `max` (1,500 / 7,000 / 20,000 monthly AI credits). Business and Enterprise credits are organization-pooled, so consumed credits are shown without inventing a per-user remainder. Accounts still on request billing fall back to the premium-request report.
2. **OAuth fallback** — OpenCode's `github-copilot` login, rendering every `quota_snapshots` entry.
</details>

<details>
<summary><strong>Google (Antigravity)</strong> — Antigravity Tools, else direct</summary>

<br>

**With Antigravity Tools running**, mystatus reads its port and management credential from `~/.antigravity_tools/gui_config.json` and uses the read-only management API: one card per enabled account with Gemini, Gemini 4 Argon, and Claude/GPT **5-hour + weekly** groups, account state, and proxy token/request usage. Antigravity proxies declared in `opencode.json` (any provider whose id or name contains "antigravity", using its own `baseURL` and `apiKey`) are tried next. Credentials read from `gui_config.json` are only ever sent to loopback addresses.

For a custom port, container, or remote instance:

```bash
export ANTIGRAVITY_TOOLS_BASE_URL="http://127.0.0.1:8045/v1"   # /v1 or /api suffix is fine
export ANTIGRAVITY_TOOLS_API_KEY="sk-..."
export ANTIGRAVITY_TOOLS_ADMIN_PASSWORD="..."                  # if the Web UI has one
export ANTIGRAVITY_TOOLS_USAGE_HOURS=168
```

The same keys can live under `antigravityTools` in `mystatus.json` (`baseUrl`, `apiKey`, `adminPassword`, `usageHours`, `includeUsage`); environment variables win. An explicit base URL pins that instance.

**Otherwise** mystatus queries Google directly for every [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) account (`antigravity-accounts.json`, cross-checked against OpenCode's `google` connections), in parallel, via `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`. Models are grouped into families — **Gemini Argon** (`gemini-4-argon-*`, its own weekly pool, shown only for accounts entitled to it), Gemini Pro, Gemini Flash, Claude, GPT-OSS — using the most conservative bucket in each. If the live call fails, the plugin's cached quota is shown with its age. Use `google.excludeEmails` in `mystatus.json` to hide accounts.
</details>

<details>
<summary><strong>Kimi, MiniMax, Z.AI</strong> — OpenCode login</summary>

<br>

- **Kimi for Coding** reads `kimi-for-coding` and shows weekly + rolling 5-hour windows from `api.kimi.com/coding/v1/usages`.
- **MiniMax** reads `minimax-coding-plan` (key starts with `sk-cp-`) and shows the unified 5-hour + weekly Token Plan pools.
- **Z.AI** reads `zai-coding-plan` and shows the 5-hour and weekly prompt pools plus separately labeled monthly MCP/tool-call limits.
</details>

<details>
<summary><strong>LongCat</strong> — browser session</summary>

<br>

Inference keys (`ak_…`) cannot read quota. Log into [longcat.chat/platform/usage](https://longcat.chat/platform/usage), then copy `passport_token_key` and `long_cat_region_key` (usually `2`) from DevTools → Application → Cookies, or the whole `Cookie` header. The card shows the **free quota** (what blocks inference when empty), **total tokens** including fuel packs, and the nearest fuel-pack expiry.
</details>

<details>
<summary><strong>Meta Muse Code</strong> — opencode-muse or muse CLI</summary>

<br>

Uses the `muse` connection created by the `opencode-muse` plugin (`opencode auth login` → Muse), falling back to the `muse` CLI login at `~/.config/muse/auth.json` (`MUSE_AUTH_PATH` / `XDG_CONFIG_HOME` respected). Several connections for the same account collapse to the active one.

Muse has **no read-only usage endpoint**: plan usage is only returned by `POST api.meta.ai/muse-code/key`, the call the plugin and CLI use to mint their 24-hour API key. mystatus makes the same call and shows `subs_usage.window` (rolling 5-hour) and `subs_usage.weekly`. Each call mints a new key (existing keys keep working), so live checks are limited to **once per 15 minutes**, even with `fresh` — in between, the cached card is shown with its age.
</details>

<details>
<summary><strong>Mistral, Ollama, QwenCloud, StepFun, BytePlus</strong> — browser session</summary>

<br>

- **Mistral** — the `console.mistral.ai` Cookie header (with `csrftoken`); each account's Vibe percentage is labeled as its **monthly** budget.
- **Ollama** — the `ollama.com` Cookie header (with `__Secure-session`); session and weekly GPU-time windows come from `/settings`, the renewal date from `/settings/billing`. Inference keys cannot read quota.
- **QwenCloud** — `login_qwencloud_ticket`, `login_aliyunid_pk`, `isg`, and optionally `login_ESM_account_ticket` from `home.qwencloud.com`.
- **StepFun** — `Oasis-Token`, `Oasis-Webid`, and `__Secure-next-auth.session-token` from `platform.stepfun.ai`; a weekly window is shown only if the dashboard returns one.
- **BytePlus** — the `console.byteplus.com` Cookie header.
</details>

<details>
<summary><strong>NanoGPT</strong> — OpenCode login and multi-auth pool</summary>

<br>

Reads OpenCode's `nano-gpt` key and the `opencode-nanogpt-multi-auth` pool at `~/.local/share/opencode/nanogpt-keys.json`; each pool key gets its own labeled card and duplicates are removed. Shows USD/XNO balance and both the daily/monthly operation pools and the newer weekly-token/daily-image pools.
</details>

<details>
<summary><strong>OpenAI</strong> — Codex-client login required for usage</summary>

<br>

OpenCode V2's default **Sign in with ChatGPT** uses ChatGPT *token sharing* (`chatgpt-token-sharing`, `oaiapp_…` client). Those tokens only authorize inference on `api.openai.com/v1`; the usage endpoint (`chatgpt.com/backend-api/wham/usage`) rejects them and OpenAI offers no other route. mystatus therefore uses, in order:

1. an OpenCode `openai` login from the legacy **Codex browser** method, then
2. the Codex CLI login in `~/.codex/auth.json` (`CODEX_HOME` respected).

If you only have a token-sharing login, run `codex login` once. The Codex token is read-only here — if it expires, run `codex` to refresh it. The card shows the plan, credits, the general limit, code-review limit, every named model limit (e.g. GPT-5.3-Codex-Spark), reset credits, and spend controls.
</details>

<details>
<summary><strong>OpenCode Go + Zen</strong> — workspace cookie for quota and spend</summary>

<br>

An API key alone only confirms reachability. Save `opencode-go.json` with your workspace UUID (from `opencode.ai/workspace/<uuid>/go`) and the `auth` cookie from `opencode.ai`, or use `{ "accounts": [ { "id", "name", "workspaceId", "authCookie" } ] }` for several workspaces. `OPENCODE_GO_WORKSPACE_ID` / `OPENCODE_GO_AUTH_COOKIE` also work.
</details>

<details>
<summary><strong>Poe and Synthetic</strong> — OpenCode login or your own key</summary>

<br>

- **Poe** — OpenCode `poe`, then `POE_API_KEY`, then `poe-api-key.json` (`{ "apiKey": "..." }`; get one at <https://poe.com/api_key>). The total point balance is authoritative; a monthly percentage appears only when plan-only points are reported, so add-on points never inflate it.
- **Synthetic** — OpenCode `synthetic`, then `SYNTHETIC_API_KEY`, then `synthetic-api-key.json`. [`/v2/quotas`](https://dev.synthetic.new/docs/synthetic/quotas) doesn't consume allowance. Shows subscription requests (with renewal countdown), the **weekly plan limit** — which regenerates a few percent per tick rather than resetting — and hourly search requests.
</details>

<details>
<summary><strong>xAI / Grok</strong> — grok login or OpenCode</summary>

<br>

Prefers the consumer token from `grok login` (`~/.grok/auth.json`, refreshed and written back like the Grok CLI does), falling back to OpenCode's `xai` / `xai-oauth` login. SuperGrok is one shared **weekly** pool across API, Build, Chat, Imagine, and Voice; the card shows it with a per-product breakdown and extra-usage credits, and labels the monthly dollar ledger as a reference.
</details>

## Configuration

Most setups need none. For persistent defaults, create `~/.config/opencode/mystatus.json` (comments allowed). Every key is documented in [`mystatus.example.json`](mystatus.example.json).

```jsonc
{
  "view": "compact",          // compact (problems first) | classic (one card per provider)
  // "width": 120,            // pin a render width
  "layout": "auto",           // auto | single | double
  "sort": "urgency",          // urgency | name | reset
  "summary": true,
  "trend": "compact",         // off | compact | full
  "cacheTtlSec": 0,           // 0 = always live; cache is still the failure fallback
  "historyMax": 60,           // trend snapshots kept
  "historyMinIntervalSec": 60,
  "providers": {
    "disabled": [],           // never query, e.g. ["poe", "longcat"]
    "hidden": [],             // query but hide (managed by the TUI/desktop `x` key)
    "order": []               // tie-break order before sorting
  },
  "google": { "excludeEmails": [] },
  "antigravityTools": { "enabled": true, "usageHours": 168, "includeUsage": true }
}
```

State files written next to it: `mystatus-cache.json` (last good result per provider, shown as **stale** with its age when a live query fails) and `mystatus-history.json` (trend snapshots).

## Live dashboard

`mystatus --watch` opens a full-screen, differentially painted TUI that keeps syncing (default every 60 s) with reset countdowns ticking every second.

| Key | Action |
|---|---|
| `1` `2` `3` / `Tab` | **Current** (what you have left now) · **Weekly** (every 7-day window) · **Monthly** (billing cycles of multi-tier plans) |
| `e` | Issues pane — failed providers, stale cached data, providers with no credentials |
| `x` | Hide the provider under the cursor (still queried; saved to `providers.hidden`), or unhide it from the Hidden tab |
| `d` | Density: auto · detail · compact (one row per provider) |
| `j`/`k`, arrows, `space`/`b`, `g`/`G` | Scroll, page, top/bottom |
| `r` / `q` | Sync now / quit |

`--interval <seconds>` changes the sync period; `watchIntervalSec`, `uiRefreshSec`, and `cacheTtlSec` in `mystatus.json` do the same persistently.

```text
 usage  8 accounts  ·  5 ok  ·  1 watch  ·  2 low                      12s ago   sync 48s
 1 Current  ·  2 Weekly  ·  3 Monthly  ·  e Issues 2            2 stale  ·  detail (auto)
─────────────────────────────────────────────────────────────────────────────────────────
 Anthropic
   5-hour limit            █████░░░░░░░░░░░░░░░░░░░░░  18%  ↻ 1h 12m
 Google — alex
   Gemini 4 Argon · Weekly ░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  ↻ 4d 14h
   Gemini · 5-hour         ██████████████████████████ 100%  ↻ 4h 59m
 xAI/Grok
   Weekly SuperGrok        ████████████████████░░░░░░  76%  ↻ 5d 2h
─────────────────────────────────────────────────────────────────────────────────────────
 1/2/3 view  ·  e issues  ·  d density  ·  j/k scroll  ·  r sync  ·  q quit
```

## Desktop app

`desktop/` contains **mystatus-desktop**, an Electron + React app that imports the same core in-process.

```bash
npm --prefix desktop install
npm --prefix desktop run dev       # development window with HMR
npm --prefix desktop run build     # production bundle
cd desktop && npx electron-builder --dir   # unpacked app in desktop/release/
```

- **Dashboard** with Current / Weekly / Monthly tabs, summary header, live countdowns, trend sparklines, hide/show, and an Issues panel.
- **In-app sign-in** for every cookie provider: opens the provider's login page in an isolated session and writes the exact JSON file the core reads.
- **Guided paste** for the Copilot PAT and Poe key.
- **Settings** for every `mystatus.json` key, written atomically with verify-after-write.
- **Tray icon** colored by the worst limit, **low-quota notifications** on threshold crossings (with a per-limit cooldown), export to JSON/text, and launch at login.

Desktop-only preferences (`threshold`, `notifications`, `notifyCooldownMin`, `trendMode`, `lastTab`, `windowBounds`, `launchAtLogin`) live in `~/.config/opencode/mystatus-desktop.json` and never hold credentials.

Builds are unsigned: on macOS right-click → **Open** the first time; on Windows choose **More info → Run anyway**. Auto-update stays off unless you ship a signed, packaged build with `MYSTATUS_ENABLE_UPDATES=1`.

<details>
<summary>Maintainer notes</summary>

<br>

- `desktop/src/renderer/lib/tiers.ts` re-implements the TUI's private window-tier classification (`plugin/tui.ts`). If the TUI's classification changes, re-verify it against the golden fixtures.
- `desktop/src/shared/providers.ts` mirrors the core's provider registry for the Settings page; update it when a provider is added.
- The plugin, CLI, TUI, and desktop app share `mystatus.json`, `mystatus-cache.json`, and `mystatus-history.json`. The desktop app re-reads before every save and writes atomically so external edits are not clobbered.
</details>

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `No OpenCode credentials found` | No provider is signed in anywhere mystatus looks. Sign in through OpenCode (`opencode auth login`), or check the paths printed with the error. |
| **OpenAI:** "token sharing login cannot read ChatGPT usage" | OpenCode V2's default ChatGPT login can't read usage. Run `codex login` once. |
| **OpenAI / Anthropic:** "token expired … run `codex` / `claude`" | That token belongs to the Codex CLI or Claude Code, which mystatus won't refresh. Run the named command once. |
| **Muse** shows `cached (N min ago)` | Expected: live checks are throttled to every 15 minutes because each one mints an API key. |
| **Google** cards lack proxy stats | Antigravity Tools isn't reachable, so mystatus fell back to querying Google directly. Start Antigravity Tools, or set `ANTIGRAVITY_TOOLS_BASE_URL`. |
| A card says `stale · cached …` | The live query failed; the last good result is shown with its age and the reason. Run with `--fresh` once the provider recovers. |
| `/mystatus` still shows old output after updating | OpenCode loads `dist/` once. Rebuild (`npm run build`) and restart OpenCode, including any background `opencode serve` process. |
| A trend sparkline looks odd right after an update | Trends come from your own history; renamed or split limits (e.g. Gemini Argon moving out of Gemini Pro) settle after a few runs. |

## Security &amp; privacy

- Credentials are read locally and sent **only** to the provider they belong to (Antigravity Tools credentials only to its own origin).
- The OpenCode database is opened **read-only**; Claude Code and Codex CLI tokens are never refreshed or rewritten. The one file mystatus refreshes and writes back is `~/.grok/auth.json`, the same way the Grok CLI does.
- **One deliberate side effect:** each Muse check mints a fresh 24-hour API key, because that is Muse's only usage source. It is throttled to once per 15 minutes.
- The only other files written live in `~/.config/opencode/`: `mystatus-cache.json`, `mystatus-history.json`, and `mystatus.json` when you hide a provider from the TUI or change settings in the desktop app. Nothing is logged or sent anywhere else.

<details>
<summary>Endpoints contacted</summary>

<br>

| Provider | Endpoint(s) |
|---|---|
| Anthropic | `api.anthropic.com/api/oauth/usage`, `/api/oauth/profile`; `console.anthropic.com/v1/oauth/token` (OpenCode credential refresh only) |
| AtlasCloud | `console.atlascloud.ai/api/v1/{current-user,codeplan/get,codeplan/costs}` |
| BytePlus | `console.byteplus.com/api/top/ark/…/GetCodingPlanUsage` |
| GitHub Copilot | `api.github.com/copilot_internal/*`, `api.github.com/users/*/settings/billing/…` |
| Google | Antigravity Tools `/health`, `/api/accounts`, `/api/stats/token/*`; fallback `oauth2.googleapis.com/token`, `cloudcode-pa.googleapis.com/v1internal:{loadCodeAssist,retrieveUserQuota}` |
| Kimi for Coding | `api.kimi.com/coding/v1/usages` |
| LongCat | `longcat.chat/api/lc-platform/v1/{tokenUsage,query-active-apiKeys}`, `/api/v1/user-current` |
| Meta Muse Code | `POST api.meta.ai/muse-code/key` (mints a key; throttled) |
| MiniMax | `api.minimax.io/v1/token_plan/remains` |
| Mistral | `console.mistral.ai/api-ui/trpc/…` |
| NanoGPT | `nano-gpt.com/api/check-balance`, `/api/subscription/v1/usage` |
| Ollama | `ollama.com/settings`, `/settings/billing` |
| OpenAI | `chatgpt.com/backend-api/wham/usage` |
| OpenCode Go + Zen | `opencode.ai/zen/go/v1/models`, `opencode.ai/workspace/*/{go,billing,usage}` |
| Poe | `api.poe.com/usage/current_balance` |
| QwenCloud | `home.qwencloud.com/data/api.json`, `cs-data.qwencloud.com/data/api.json` |
| StepFun | `platform.stepfun.ai/api/…/{QueryStepPlanRateLimit,GetStepPlanStatus}` |
| Synthetic | `api.synthetic.new/v2/quotas` |
| xAI / Grok | `cli-chat-proxy.grok.com/v1/billing`, `grok.com/rest/subscriptions`, `auth.x.ai/oauth2/token`, `api.x.ai/v1/models` |
| Z.AI | `api.z.ai/api/biz/subscription/list`, `/api/monitor/usage/quota/limit` |

Several of these are internal dashboard endpoints that can change without notice; a provider that breaks degrades to a stale card or a one-line failure instead of breaking the report.
</details>

## Development

```bash
npm ci
npm run typecheck     # tsc --noEmit (strict)
npm run build         # tsc → dist/plugin/
```

| Path | What it is |
|---|---|
| `plugin/mystatus.ts` | The core: credential loading, one `query*` function per provider returning structured cards, rendering (compact + classic), cache, history, and the V1 plugin export |
| `plugin/opencode-v2.ts` | OpenCode V2 adapter around the same tool |
| `plugin/tui.ts` | `--watch` dashboard |
| `bin/mystatus`, `bin/mystatus-cli.ts` | CLI wrapper (bun) that calls the core directly |
| `command/` | `/mystatus` and `/usage` slash commands |
| `desktop/` | Electron app |

To add a provider: write a `query*` function that returns `{ success, cards }` with `QuotaWindow`s (`label`, `remaining` 0–100, `resetAt`), then register it in `PROVIDERS` and give it a short name in `PROVIDER_NAMES`. Rendering, sorting, trends, caching, JSON, the TUI, and the desktop app pick it up automatically. Keep `desktop/src/shared/providers.ts` in sync.

`dist/` is gitignored but `dist/plugin/*.js` / `*.d.ts` for `mystatus` and `opencode-v2` are tracked so installs from a clone work; after `npm run build`, add them with `git add -f`.

## Changelog · Credits · License

- Release history: [CHANGELOG.md](CHANGELOG.md).
- Originally a fork of [vbgate/opencode-mystatus](https://github.com/vbgate/opencode-mystatus), since rebuilt around a structured quota model, the problems-first view, trends, resilience, the live dashboard, the desktop app, and twenty providers.
- [MIT](LICENSE).
