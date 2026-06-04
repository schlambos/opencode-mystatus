<h1 align="center">opencode-mystatus</h1>

<p align="center">
  <strong>All your AI usage, in one glance.</strong><br>
  A unified quota &amp; spend dashboard for <a href="https://opencode.ai">OpenCode</a> — ten providers, one command.
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
- **One place for everything.** Ten providers, multiple accounts each, in a single scrollable view.
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
│  Accounts:       10   🟩 7  🟨 2  🟧 1                           │
│  Lowest:         OpenCode Go+Zen — OpenCode Go Personal · Mont…  │
│  Soonest reset:  OpenCode Go+Zen — OpenCode Go Alt 1 · 5h (rol…  │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Anthropic Account Quota ────────────────────────────────────────╮
│                                                                  │
│  Account:        Claude Pro/Max                                  │
│                                                                  │
  │  5-hour limit                                                    │
  │  🟩 ███████████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 43% remaining  │
  │     ▼2%/4m ▅▄▄  ~1h 40m to empty                                  │
  │  Resets in: 2h 51m                                               │
  │                                                                  │
  │  7-day limit                                                     │
  │  🟩 ████████████████████████████░░░░░░░░░░░░░░░░░ 61% remaining  │
  │     → 0% ▅▅▅                                                     │
│  Resets in: 5d 31m                                               │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ NanoGPT Account Quota ──────────────────────────────────────────╮
│                                                                  │
│  Balance:        $4.20                                           │
│  Plan:           Subscription (stripe)                           │
│                                                                  │
  │  Weekly input tokens                                             │
  │  🟩 █████████████████████████████░░░░░░░░░░░░░░░░ 65% remaining  │
  │     ▼4%/4m ▅▅  ~1h 5m to empty                                    │
│  Used: 21M / 60M                                                 │
│  Resets in: 4d 19h 31m                                           │
│                                                                  │
│  Daily images                                                    │
│  🟩 ████████████████████████████████████████████ 100% remaining  │
│  Used: 0 / 100                                                   │
│  Resets in: 19h 31m                                              │
│                                                                  │
│  Renews:         29d 22h 21m                                     │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

⚠️ Low quota alerts:
  • OpenCode Go+Zen — OpenCode Go Personal: 4%
```

## Supported providers

| Provider | Account type | What you see |
|---|---|---|
| **OpenAI** | ChatGPT Plus / Team / Pro | 5-hour &amp; 7-day rolling windows, credits |
| **Anthropic** | Claude Pro / Max | 5-hour, 7-day, and per-model windows (auto token refresh) |
| **Google** | Antigravity free quota | Gemini Pro / Flash / Claude, per account |
| **GitHub Copilot** | Individual / Business | Premium, Chat &amp; Completions usage |
| **OpenCode Go+Zen** | Any Go subscription | Rolling/weekly/monthly quota **+** Zen balance &amp; per-model spend |
| **Poe** | Subscription or pay-go | Monthly points, daily grant, USD value |
| **Z.AI** | GLM Coding Plan | Plan details + rolling / weekly / monthly windows |
| **xAI / Grok** | SuperGrok | Auth validity &amp; token-expiry countdown* |
| **MiniMax** | Token Plan | 5-hour &amp; 7-day text windows |
| **NanoGPT** | Balance + subscription | USD balance, weekly tokens &amp; daily image allowances |

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

Provider ids: `openai`, `anthropic`, `google`, `copilot`, `opencode-go`, `poe`, `zai`, `xai`, `minimax`, `nanogpt`.

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
<summary><strong>Zero-config providers</strong> — OpenAI, Anthropic, Z.AI, MiniMax, NanoGPT, xAI</summary>

<br>

These read their credentials straight from OpenCode's `auth.json` once you've signed into the provider:

- **OpenAI** — calls `chatgpt.com/backend-api/wham/usage`; reports plan, credits, and 5h/7d windows.
- **Anthropic** — refreshes the Claude Code OAuth token and queries `api.anthropic.com/api/oauth/usage`.
- **Z.AI (GLM Coding Plan)** — reads `zai-coding-plan`; shows plan details plus rolling/weekly/monthly windows.
- **MiniMax (Token Plan)** — reads `minimax-coding-plan` (key must start with `sk-cp-`); shows 5h and 7-day text windows.
- **NanoGPT** — reads `nano-gpt`; shows USD/Nano balance and, for subscribers, weekly-token and daily-image allowances with renewal date.
- **xAI / Grok** — reads `xai-oauth`; confirms the token is valid and shows its expiry (no public usage API exists).
</details>

<details>
<summary><strong>Google (Antigravity)</strong> — requires the auth plugin</summary>

<br>

Install [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) and sign into at least one account. Accounts are read from `~/.config/opencode/antigravity-accounts.json`. Each account attempts a live fetch and falls back to the cached quota (labelled with its age) if the live call fails. Multiple accounts render as separate cards.
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

## Security &amp; privacy

`mystatus` is **read-only** for your accounts and contacts each provider's own API only.

- Credentials are read locally and sent **only** to their respective provider.
- The only files it *writes* are local, non-sensitive helpers in `~/.config/opencode/`: a small cache (`mystatus-cache.json`) and trend history (`mystatus-history.json`).
- Nothing is logged or transmitted anywhere else. The full source is open for review.

<details>
<summary>Files read &amp; endpoints contacted</summary>

<br>

**Read (never modified):** `~/.local/share/opencode/auth.json`, and the optional `antigravity-accounts.json`, `opencode-go.json`, `copilot-quota-token.json`, `poe-api-key.json` under `~/.config/opencode/`.

| Provider | Endpoint(s) |
|---|---|
| OpenAI | `chatgpt.com/backend-api/wham/usage` |
| Anthropic | `api.anthropic.com/api/oauth/usage`, `console.anthropic.com/v1/oauth/token` |
| Google | `cloudcode-pa.googleapis.com/...:fetchAvailableModels`, `oauth2.googleapis.com/token` |
| GitHub Copilot | `api.github.com/copilot_internal/*`, `api.github.com/users/*/settings/billing/...` |
| OpenCode Go+Zen | `opencode.ai/zen/go/v1/models`, `opencode.ai/workspace/*/{go,billing,usage}` |
| Poe | `api.poe.com/usage/current_balance` |
| Z.AI | `api.z.ai/api/biz/subscription/list`, `api.z.ai/api/monitor/usage/quota/limit` |
| xAI / Grok | `api.x.ai/v1/models` |
| MiniMax | `api.minimax.io/v1/token_plan/remains` |
| NanoGPT | `nano-gpt.com/api/check-balance`, `nano-gpt.com/api/subscription/v1/usage` |

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

Originally a fork of [vbgate/opencode-mystatus](https://github.com/vbgate/opencode-mystatus), since rebuilt and extended well beyond the original: a structured quota model, responsive single-column cards, a summary view, urgency sorting, usage trends with projections, caching/retry resilience, and support for Anthropic, GitHub Copilot, OpenCode Go+Zen, Poe, multi-account Google, Z.AI, xAI/Grok, MiniMax, and NanoGPT.

## License

[MIT](LICENSE)
