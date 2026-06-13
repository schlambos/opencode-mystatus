<h1 align="center">opencode-mystatus</h1>

<p align="center">
  <strong>All your AI usage, in one glance.</strong><br>
  A unified quota &amp; spend dashboard for <a href="https://opencode.ai">OpenCode</a> — fourteen providers, one command.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-mystatus"><img src="https://img.shields.io/npm/v/opencode-mystatus?color=cb3837&label=npm" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://opencode.ai"><img src="https://img.shields.io/badge/OpenCode-plugin-black.svg" alt="OpenCode Plugin"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg" alt="Node >= 18">
</p>

---

Subscriptions pile up — ChatGPT, Claude, Gemini, Copilot, Grok, and a handful of API plans — and every one of them has its own dashboard, its own reset clock, and its own way of telling you you're out. **opencode-mystatus** pulls them all together. It reads the credentials OpenCode already stores, asks each provider how much you have left, and renders one clean, sorted, at-a-glance report — right inside your terminal.

```
/mystatus
```

## Why you'll want it

- **Never get surprised by a limit again.** See what's running low *before* it blocks you, with projected "time to empty" estimates.
- **One place for everything.** Fourteen providers, multiple accounts each, in a single scrollable view.
- **Zero busywork.** If you've signed into a provider in OpenCode, it just works — no extra keys to wire up.
- **Built for the terminal.** Responsive cards that size to your window, color-coded bars, and a summary up top.

## Highlights

- 🧭 **Summary card** — account tally, your lowest window, and the next thing to reset, right at the top.
- 🚦 **Urgency-first ordering** — whatever's closest to empty floats to the top (or sort by name / reset time).
- 📈 **Usage trends** — color-coded sparklines (green/yellow/red per data point), deltas, and *"~Xm to empty"* projection drawn from your own history.
- 🟩 **Color-coded at a glance** — emoji + ANSI bars (🟥 ≤0 · 🟧 <25 · 🟨 <50 · 🟩 ≥50) that survive even when ANSI is stripped.
- 📐 **Responsive layout** — single-column cards that resize to your terminal and never wrap.
- 💸 **Spend insight** — OpenCode Zen per-model cost breakdowns and balances alongside quota.
- 🛟 **Resilient** — automatic retries, a cache fallback when a provider is flaky, and graceful per-provider errors.
- 🤖 **Scriptable** — `format: json` for machine-readable output.
- 🏃 **Standalone CLI** — run `mystatus` or `usage` from any terminal, no OpenCode session needed.

## What it looks like

A single-column stack of cards, sorted by urgency, with a summary on top and low-quota alerts at the bottom *(abridged)*:

```text
╭─ Summary ────────────────────────────────────────────────────────╮
│                                                                  │
│  Accounts:       13   🟩 10  🟨 1  🟧 2                           │
│  Lowest:         Google — mattg4542@gmail.com · Claude  17%      │
│  Soonest reset:  StepFun Token Plan · 5-hour rolling  7m         │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Google — johndoe@gmail.com ─────────────────────────────────────╮
│                                                                  │
│  Gemini Pro                                                      │
│  🟩 ████████████████████████████████████████████ 100% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 4h 59m                                               │
│                                                                  │
│  Gemini Flash                                                    │
│  🟩 ████████████████████████████████████████████ 100% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 4h 59m                                               │
│                                                                  │
│  Claude                                                          │
│  🟧 ███████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 17% remaining  │
│     → 0% ▂▂▂▂▂▂▂▂▂▂                                              │
│  Resets in: 4h 29m                                               │
│                                                                  │
│  GPT-OSS                                                         │
│  🟧 ███████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 17% remaining  │
│     → 0% ▂▂▂▂▂▂▂▂▂▂                                              │
│  Resets in: 4h 29m                                               │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯
╭─ xAI/Grok ───────────────────────────────────────────────────────╮
│                                                                  │
│  Auth:           valid                                           │
│  Token expires:  4h 57m                                          │
│                                                                  │
│  SuperGrok free credits                                          │
│  🟨 █████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 37% remaining  │
│     → 0% ▃▃▃▃▃▃▃▃▃▃                                              │
│  Credits used: 63.32% · Resets Jul 1                             │
│  Resets in: 17d 10h 47m                                          │
│                                                                  │
│  Dev API (included tokens)                                       │
│  🟨 █████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 37% remaining  │
│     → 0% ▃▃▃▃▃▃▃▃▃▃                                              │
│  Used: 9,498 / 15,000 tokens                                     │
│  Resets in: 17d 10h 47m                                          │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ OpenAI Account Quota ───────────────────────────────────────────╮
│                                                                  │
│  Account:        johndoe@gmail.com                               │
│  Plan:           ChatGPT plus                                    │
│                                                                  │
│  5-hour limit                                                    │
│  🟩 ███████████████████████████████████████████░░ 95% remaining  │
│     ▼4%/1h 11m ▆▆▆▆▇▆▆▆▇▇                                        │
│  Resets in: 4h 6m                                                │
│                                                                  │
│  7-day limit                                                     │
│  🟩 ████████████████████████████████████░░░░░░░░░ 79% remaining  │
│     ▼1%/1h 11m ▆▆▆▆▆▆▆▆▆▆ ~3d 22h 19m to empty                   │
│  Resets in: 5d 2h 23m                                            │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯
⚠️ Low quota alerts:
  • Google — johndoe@gmail.com: 17%
```

## Supported providers

| Provider | Account type | What you see |
|---|---|---|
| **Anthropic** | Claude Pro / Max | 5-hour, 7-day, and per-model windows (auto token refresh) |
| **BytePlus** | Ark Coding Plan | Plan details + rolling / weekly / monthly windows |
| **GitHub Copilot** | Individual / Business | Premium, Chat & Completions usage |
| **Google** | Antigravity free quota | Gemini Pro / Flash / Claude, per account |
| **MiniMax** | Token Plan | 5-hour & 7-day text windows |
| **Mistral** | Vibe Usage | Plan details + usage tracking |
| **NanoGPT** | Balance + subscription | USD balance, weekly tokens & daily image allowances |
| **OpenAI** | ChatGPT Plus / Team / Pro | 5-hour & 7-day rolling windows, credits |
| **OpenCode Go+Zen** | Any Go subscription | Rolling/weekly/monthly quota **+** Zen balance & per-model spend |
| **Poe** | Subscription or pay-go | Monthly points, daily grant, USD value |
| **QwenCloud** | Token Plan (Team Edition) | Credits remaining + cycle dates |
| **StepFun** | Step Plan (Plus/Pro/etc.) | Plan details + 5-hour & weekly rolling windows |
| **xAI / Grok** | SuperGrok | Auth validity & token-expiry countdown* |
| **Z.AI** | GLM Coding Plan | Plan details + rolling / weekly / monthly windows |

Providers you aren't signed into are skipped silently — you only ever see what's relevant to you.

<sub>\* xAI does not expose a public usage API, so only auth validity and token expiry can be reported.</sub>

## Installation

### From npm (recommended)

Add the plugin to `~/.config/opencode/opencode.json`. The optional `command` block gives you a `/mystatus` (and `/usage`) shortcut:

```json
{
  "plugin": ["opencode-mystatus"],
  "command": {
    "mystatus": {
      "description": "Query quota usage for all AI accounts",
      "template": "Use the mystatus tool to query quota usage. Output is a single-column stack of provider cards — if you know the user's terminal width, pass it as the `width` argument so the cards size to the terminal and never wrap. Wrap the entire returned output in a single fenced ```text code block so the box-drawing borders and alignment are preserved exactly."
    }
  }
}
```

Restart OpenCode and run `/mystatus`.

### From source

```bash
cp plugin/mystatus.ts ~/.config/opencode/plugin/
cp command/mystatus.md command/usage.md ~/.config/opencode/command/
cp bin/mystatus bin/mystatus-cli.ts ~/.local/bin/
chmod +x ~/.local/bin/mystatus
ln -sf ~/.local/bin/mystatus ~/.local/bin/usage
```

Then restart OpenCode.

## Standalone CLI

The plugin ships with a terminal CLI so you can check your quotas without launching OpenCode at all. It uses `bun` to call the same core logic directly.

```bash
mystatus                    # all providers, ANSI
mystatus --only openai      # single provider
mystatus --format json      # machine-readable
mystatus --trend full       # with projections
mystatus --fresh            # bypass cache
mystatus --help             # all options
```

An alias `usage` is also installed (symlinked to `mystatus`).

### Install via the repo

```bash
git clone https://github.com/schlambos/opencode-mystatus.git
cd opencode-mystatus
./bin/mystatus --install
```

This symlinks `mystatus` and `usage` into `~/.local/bin/` (or a target of your choice).

### Requirements

- [bun](https://bun.sh) — the CLI wrapper imports the plugin source directly via `bin/mystatus-cli.ts`.
- Your credentials are read from OpenCode's standard locations (`~/.local/share/opencode/auth.json`, `~/.config/opencode/mystatus.json`, etc.) — no extra setup needed if you've already signed into providers.

## Usage

Trigger it however feels natural:

- The **`/mystatus`** or **`/usage`** slash command inside OpenCode
- **`mystatus`** from any terminal (see [standalone CLI](#standalone-cli))
- Plain language — *"check my AI quota"*, *"how much Claude do I have left?"*, *"am I about to run out of anything?"*

### Options

All options are optional and can be set per-call or as [defaults in your config](#configuration):

| Option | Values | Default | Description |
|---|---|---|---|
| `width` | number | auto | Target terminal width; cards size to fit and never wrap |
| `sort` | `urgency` · `name` · `reset` | `urgency` | Card ordering |
| `summary` | boolean | `true` | Show the summary card on top |
| `trend` | `off` · `compact` · `full` | `compact` | Trend line under each bar with color-coded sparkline (`full` adds projection) |
| `threshold` | number | `25` | Percent below which a window triggers a low-quota alert |
| `only` | comma list | — | Show only these provider ids |
| `exclude` | comma list | — | Hide these provider ids |
| `fresh` | boolean | `false` | Bypass the cache and force a live fetch |
| `format` | `ansi` · `json` | `ansi` | `json` returns machine-readable output |

Provider ids: `anthropic`, `byteplus`, `copilot`, `google`, `minimax`, `mistral`, `nanogpt`, `openai`, `opencode-go`, `poe`, `qwencloud`, `stepfun`, `xai`, `zai`.

## Configuration

Most setups need **no configuration at all**. To set persistent defaults, create `~/.config/opencode/mystatus.json` (comments are allowed). A fully documented sample lives at [`mystatus.example.json`](mystatus.example.json):

```jsonc
{
  "sort": "urgency",        // urgency | name | reset
  "summary": true,          // show the summary card
  "trend": "full",          // off | compact | full
  "cacheTtlSec": 0,         // 0 = always live; cache is used only as a failure fallback
  "historyMax": 60,         // trend snapshots to retain
  "historyMinIntervalSec": 60,
  "providers": {
    "disabled": [],         // e.g. ["xai"]
    "order": []             // preferred ordering before sort
  }
  // "width": 100           // uncomment to pin a render width
}
```

**Width resolution order:** `width` arg → `MYSTATUS_WIDTH` / `COLUMNS` env → live TTY → config `width` → safe default.

> Trends need at least two snapshots, so the very first run shows none — they appear from the second run onward.

## Provider setup

Anything authenticated inside OpenCode is detected automatically. The collapsible sections below cover the handful of providers with optional extra setup.

<details>
<summary><strong>Anthropic</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Refreshes the Claude Code OAuth token and queries `api.anthropic.com/api/oauth/usage`.
</details>

<details>
<summary><strong>BytePlus (Ark Coding Plan)</strong> — requires browser cookies from the dashboard</summary>

<br>

BytePlus does not expose a usage REST API — instead the plugin reads the dashboard's internal API using your authenticated browser session. To set it up:

1. Log into <https://console.byteplus.com>.
2. Open DevTools → Application → Cookies → `console.byteplus.com`.
3. Copy the value of the auth cookie and save to `~/.config/opencode/byteplus-cookies.json`:

```json
{
  "cookie": "<full cookie string>"
}
```

The session cookie expires periodically — re-copy the cookie when it does. Without this file the BytePlus card is silently skipped.
</details>

<details>
<summary><strong>GitHub Copilot</strong> — optional PAT for the most reliable numbers</summary>

<br>

Two auth paths are tried in order:

1. **Fine-grained PAT (recommended).** Create a token with **Plan → Read-only** at <https://github.com/settings/tokens?type=beta>, then save `~/.config/opencode/copilot-quota-token.json`:
   ```json
   { "token": "github_pat_...", "username": "YourGitHubUsername", "tier": "pro" }
   ```
   Tiers &amp; monthly premium limits: `free` (50), `pro` (300), `pro+` (1500), `business` (300), `enterprise` (1000).
2. **OAuth fallback** from `auth.json` → `github-copilot` (with automatic token exchange).
</details>

<details>
<summary><strong>Google (Antigravity)</strong> — requires the auth plugin</summary>

<br>

Install [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) and sign into at least one account. Accounts are read from `~/.config/opencode/antigravity-accounts.json`. Each account attempts a live fetch and falls back to the cached quota (labelled with its age) if the live call fails. Multiple accounts render as separate cards.
</details>

<details>
<summary><strong>MiniMax (Token Plan)</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads `minimax-coding-plan` (key must start with `sk-cp-`); shows 5h and 7-day text windows.
</details>

<details>
<summary><strong>Mistral</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads `mistral-vibe`; shows Vibe Usage plan details and usage tracking.
</details>

<details>
<summary><strong>NanoGPT</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads native `auth.json` `nano-gpt` keys and `opencode-nanogpt-multi-auth`'s `~/.local/share/opencode/nanogpt-keys.json` pool; shows USD/Nano balance and, for subscribers, weekly-token and daily-image allowances with renewal date.
</details>

<details>
<summary><strong>OpenAI</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Calls `chatgpt.com/backend-api/wham/usage`; reports plan, credits, and 5h/7d windows.
</details>

<details>
<summary><strong>OpenCode Go+Zen</strong> — add a workspace cookie for full quota + spend</summary>

<br>

With just an API key (`auth.json` → `opencode-go`) the plugin confirms reachability. To see quota windows **and** Zen balance/spend together, add a workspace ID + browser auth cookie to `~/.config/opencode/opencode-go.json`:

```json
{
  "accounts": [
    {
      "id": "personal",
      "name": "OpenCode Go Personal",
      "workspaceId": "your_workspace_id",
      "authCookie": "the_auth_cookie_value"
    }
  ]
}
```

Single-account shorthand `{ "workspaceId": "...", "authCookie": "..." }` or the `OPENCODE_GO_WORKSPACE_ID` / `OPENCODE_GO_AUTH_COOKIE` env vars also work.

- **Workspace ID** — from the URL at <https://opencode.ai/workspace> (`.../workspace/<uuid>/go`).
- **Auth cookie** — DevTools → Application → Cookies → `opencode.ai` → `auth` (expires with your browser session).
</details>

<details>
<summary><strong>Poe</strong> — auto-detected, or bring your own key</summary>

<br>

Resolved in priority order: `auth.json` → `poe` (populated when you use a Poe model in OpenCode), then `POE_API_KEY`, then `~/.config/opencode/poe-api-key.json` (`{ "apiKey": "..." }`). Get a key at <https://poe.com/api_key>.
</details>

<details>
<summary><strong>QwenCloud</strong> — requires browser cookies from the dashboard</summary>

<br>

QwenCloud does not expose a usage REST API — instead the plugin reads the Aliyun BSS console API using your authenticated browser session. To set it up:

1. Log into <https://home.qwencloud.com>.
2. Open DevTools → Application → Cookies → `home.qwencloud.com`.
3. Copy the values of these cookies and save to `~/.config/opencode/qwencloud-cookies.json`:

```json
{
  "ticket": "<login_qwencloud_ticket>",
  "aliyunPk": "<login_aliyunid_pk>",
  "isg": "<isg>",
  "esmTicket": "<login_ESM_account_ticket>"
}
```

The `esmTicket` is optional. Session cookies expire periodically — re-copy them when the card stops working. Without this file the QwenCloud card is silently skipped.
</details>

<details>
<summary><strong>StepFun</strong> — requires browser cookies from the dashboard</summary>

<br>

StepFun does not expose a usage REST API — instead the plugin reads the dashboard's internal tRPC API using your authenticated browser session. To set it up:

1. Log into <https://platform.stepfun.ai>.
2. Open DevTools → Application → Cookies → `platform.stepfun.ai`.
3. Copy the values of these three cookies and save to `~/.config/opencode/stepfun-cookies.json`:

```json
{
  "oasisToken": "<Oasis-Token value>",
  "oasisWebid": "<Oasis-Webid value>",
  "sessionToken": "<__Secure-next-auth.session-token value>"
}
```

The session token expires periodically — re-copy the cookies when it does. Without this file the StepFun card is silently skipped.
</details>

<details>
<summary><strong>xAI / Grok</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads `xai-oauth`; confirms the token is valid and shows its expiry (no public usage API exists).
</details>

<details>
<summary><strong>Z.AI (GLM Coding Plan)</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads `zai-coding-plan`; shows plan details plus rolling/weekly/monthly windows.
</details>

## Security &amp; privacy

`mystatus` is **read-only** for your accounts and contacts each provider's own API only.

- Credentials are read locally and sent **only** to their respective provider.
- The only files it *writes* are local, non-sensitive helpers in `~/.config/opencode/`: a small cache (`mystatus-cache.json`) and trend history (`mystatus-history.json`).
- Nothing is logged or transmitted anywhere else. The full source is open for review.

<details>
<summary>Files read &amp; endpoints contacted</summary>

<br>

**Read (never modified):** `~/.local/share/opencode/auth.json`, and the optional `antigravity-accounts.json`, `opencode-go.json`, `copilot-quota-token.json`, `poe-api-key.json`, `stepfun-cookies.json`, `qwencloud-cookies.json`, `byteplus-cookies.json` under `~/.config/opencode/`.

| Provider | Endpoint(s) |
|---|---|
| Anthropic | `api.anthropic.com/api/oauth/usage`, `console.anthropic.com/v1/oauth/token` |
| BytePlus | `console.byteplus.com/api/...` |
| GitHub Copilot | `api.github.com/copilot_internal/*`, `api.github.com/users/*/settings/billing/...` |
| Google | `cloudcode-pa.googleapis.com/...:fetchAvailableModels`, `oauth2.googleapis.com/token` |
| MiniMax | `api.minimax.io/v1/token_plan/remains` |
| Mistral | `vibe.mistral.ai/api/...` |
| NanoGPT | `nano-gpt.com/api/check-balance`, `nano-gpt.com/api/subscription/v1/usage` |
| OpenAI | `chatgpt.com/backend-api/wham/usage` |
| OpenCode Go+Zen | `opencode.ai/zen/go/v1/models`, `opencode.ai/workspace/*/{go,billing,usage}` |
| Poe | `api.poe.com/usage/current_balance` |
| QwenCloud | `home.qwencloud.com/data/api.json?...GetSeatSubscriptionSummary` |
| StepFun | `platform.stepfun.ai/api/.../Dashboard/QueryStepPlanRateLimit`, `.../GetStepPlanStatus` |
| xAI / Grok | `api.x.ai/v1/models` |
| Z.AI | `api.z.ai/api/biz/subscription/list`, `api.z.ai/api/monitor/usage/quota/limit` |

Some usage endpoints are internal/undocumented and may change without notice; the plugin degrades gracefully when one is unavailable.
</details>

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run build       # tsc → dist/
```

The plugin is a single self-contained module at `plugin/mystatus.ts`. Providers are registered in one array — each is an independent `query*` function that returns a structured `ProviderCard`, so adding a new one is a small, contained change.

The standalone CLI lives at `bin/mystatus-cli.ts` — a thin wrapper that imports `MyStatusPlugin` and calls `execute()` directly, bypassing OpenCode. The `bin/mystatus` bash script finds its way via `dirname $0` so it works from any location after `--install`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Credits

Originally a fork of [vbgate/opencode-mystatus](https://github.com/vbgate/opencode-mystatus), since rebuilt and extended well beyond the original: a structured quota model, responsive single-column cards, a summary view, urgency sorting, usage trends with projections, caching/retry resilience, and support for Anthropic, BytePlus (Ark Coding Plan), GitHub Copilot, MiniMax, Mistral (Vibe Usage), NanoGPT, OpenCode Go+Zen, Poe, multi-account Google, QwenCloud, StepFun, xAI/Grok, and Z.AI.

## License

[MIT](LICENSE)
