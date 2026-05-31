# opencode-mystatus

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-plugin-black.svg)](https://opencode.ai)

**One command. Every AI subscription. All your quota in one place.**

`opencode-mystatus` is an all-in-one quota dashboard for [OpenCode](https://opencode.ai). It reads the credentials OpenCode already stores, talks to each provider's usage API, and renders a unified report of how much you have left and when it resets — across **seven** platforms.

```
/mystatus
```

## Supported Platforms

| Platform           | Account Type              | Source / Auth                                          |
|--------------------|---------------------------|--------------------------------------------------------|
| **OpenAI**         | ChatGPT Plus / Team / Pro | `auth.json` → `openai`                                 |
| **Anthropic**      | Claude Pro / Max          | `auth.json` → `anthropic` (auto-refresh)               |
| **Google**         | Antigravity free quota    | `antigravity-accounts.json` (multi-account)            |
| **GitHub Copilot** | Individual / Business     | `auth.json` → `github-copilot` *or* fine-grained PAT   |
| **OpenCode Go**    | Any Go subscription       | API key from `auth.json` *or* dashboard cookie (multi) |
| **Poe**            | Subscription or pay-go    | `auth.json`, `POE_API_KEY`, or `poe-api-key.json`      |
| **Z.AI**           | GLM Coding Plan           | `auth.json` → `zai-coding-plan`                        |

Platforms you aren't signed into are skipped silently — you only see what's relevant to you.

## Sample Output

A full run with every platform configured. Platforms you aren't signed into are simply omitted.

```
## OpenAI Account Quota

Account:        you@example.com
Plan:           ChatGPT plus

5-hour limit
██████████████████████████ 99% remaining
Resets in: 5h

7-day limit
████████████░░░░░░░░░░░░░░ 45% remaining
Resets in: 6d 4h

## Anthropic Account Quota

Account:        Claude Pro/Max

5-hour limit
███████████████████████░░░ 90% remaining
Resets in: 1h 38m

7-day limit
████████████░░░░░░░░░░░░░░ 45% remaining
Resets in: 1d 18m

7-day (Sonnet)
█████████████████████████░ 97% remaining
Resets in: 16h 3m

## Google Account Quota

### you@example.com
G3 Pro
██████████████████████████ 100% remaining
Resets in: 1h 45m

G3 Flash
██████████████████████████ 100% remaining
Resets in: 1h 45m

Claude
██████████░░░░░░░░░░░░░░░░ 40% remaining
Resets in: 5d 20h

## GitHub Copilot Account Quota

Account:        GitHub Copilot (pro)

Premium
█████████████████████░░░░░ 82% remaining (54/300)

Resets in: 12d 4h

## OpenCode Go Account Quota

### OpenCode Go Personal
5h (rolling)
██████████████████████████ 100% remaining
Resets in: 5h

Weekly
██████████████░░░░░░░░░░░░ 52% remaining
Resets in: 19h 18m

Monthly
████████░░░░░░░░░░░░░░░░░░ 32% remaining
Resets in: 20d 7h

## Poe Account Quota

Monthly
███████████████████░░░░░░░ 73% remaining
Resets in: 12d 6h

Balance:        730000 pts ($21.90 USD)
Daily grant:    +500 (Resets in: 8h)

## Z.AI Coding Plan

Plan:           GLM Coding Lite
Price:          $18.00/monthly
Valid:          2026-05-31 12:02:51 to 2026-06-30 12:02:51
Auto-renews:    2026-06-30

Monthly
██████████████████████████ 100% remaining (0/100)
Resets in: 29d 23h

5-hour rolling
███████████████████░░░░░░░ 75% remaining
Resets in: 4h

Weekly
█████████████████████████░ 95% remaining
Resets in: 6d 23h
```

## Installation

### From npm (recommended)

Add the plugin and a slash command to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-mystatus"],
  "command": {
    "mystatus": {
      "description": "Query quota usage for all AI accounts",
      "template": "Use the mystatus tool to query quota usage. Return the result as-is without modification."
    }
  }
}
```

### From source

Copy `plugin/mystatus.ts` into `~/.config/opencode/plugin/` and `command/mystatus.md` into `~/.config/opencode/command/`, then restart OpenCode.

## Usage

Trigger it however you like:

- The `/mystatus` slash command
- Natural language: *"Check my AI quota"*, *"How much Claude do I have left?"*, *"What's my GLM coding plan usage?"*

The tool takes no arguments. It queries every configured platform in parallel and returns a single Markdown report with progress bars and reset countdowns.

## Platform Configuration

Most platforms work with **zero configuration** — if you've authenticated the provider inside OpenCode, the credentials are already in `auth.json` and `mystatus` will use them. The sections below cover the per-platform details and the few optional config files.

### OpenAI

Reads the ChatGPT OAuth token from `auth.json` and calls `chatgpt.com/backend-api/wham/usage`. Reports the plan type plus the 5-hour and 7-day rolling windows. No setup beyond signing into the OpenAI provider in OpenCode.

### Anthropic (Claude.ai)

Reads the Claude OAuth session from `auth.json`, automatically refreshes the access token via the Claude Code OAuth client, then queries `api.anthropic.com/api/oauth/usage`. Reports the 5-hour and 7-day rolling windows. No setup beyond signing into the Anthropic provider in OpenCode.

### Google (Antigravity)

Requires the [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) plugin with at least one account signed in. Accounts are read from `~/.config/opencode/antigravity-accounts.json`.

For each account the plugin attempts a **live** fetch (refresh token → `fetchAvailableModels`) and falls back to the **cached** quota stored by the auth plugin if the live call fails (the cached value is labelled with its age). Multiple accounts are listed separately, each showing G3 Pro, G3 Flash, G3 Image, and Claude model quotas.

### GitHub Copilot

Two authentication paths, tried in order:

**1. Fine-grained PAT (most reliable).** Create a fine-grained personal access token with **Plan → Read-only** permission at <https://github.com/settings/tokens?type=beta>, then save `~/.config/opencode/copilot-quota-token.json`:

```json
{ "token": "github_pat_...", "username": "YourGitHubUsername", "tier": "pro" }
```

Valid tiers and their monthly premium-request limits: `free` (50), `pro` (300), `pro+` (1500), `business` (300), `enterprise` (1000). This uses GitHub's public billing API.

**2. OAuth from auth.json.** Falls back to the `github-copilot` OAuth token (with automatic token exchange) for accounts authenticated through OpenCode's Copilot provider. Reports Premium, Chat, and Completions breakdowns.

### OpenCode Go

Two modes, automatically selected:

- **API-key probe** — With only an API key (`auth.json` → `opencode-go`), the plugin calls `GET /zen/go/v1/models` to confirm reachability and list models. Quota windows are not exposed by this endpoint.
- **Dashboard scraping** — To see the rolling 5-hour, weekly, and monthly windows, supply a workspace ID and browser auth cookie. The plugin fetches `opencode.ai/workspace/<id>/go` and parses the SolidJS SSR hydration payload.

Configure one or more accounts in `~/.config/opencode/opencode-go.json`:

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

Single-account shorthand:

```json
{ "workspaceId": "your_workspace_id", "authCookie": "the_auth_cookie_value" }
```

Or use environment variables `OPENCODE_GO_WORKSPACE_ID` and `OPENCODE_GO_AUTH_COOKIE`.

**Workspace ID** — open <https://opencode.ai/workspace>, select your Go workspace, and copy the UUID from the URL (`.../workspace/<uuid>/go`).

**Auth cookie** — while logged into `opencode.ai`, open DevTools → Application → Cookies → `opencode.ai` and copy the `auth` cookie value. It expires with your browser session.

### Poe

Queries `api.poe.com/usage/current_balance` with a bearer token, resolved in priority order:

1. `access` / `refresh` token from `auth.json` → `poe` (populated automatically when you use a Poe model in OpenCode)
2. `POE_API_KEY` environment variable
3. `~/.config/opencode/poe-api-key.json`:

```json
{ "apiKey": "your_poe_api_key" }
```

Get a key at <https://poe.com/api_key>. Output shows the monthly point balance, daily grant countdown, and USD equivalent.

### Z.AI (GLM Coding Plan)

Reads the API key from `auth.json` → `zai-coding-plan` (populated when you authenticate the Z.AI / GLM Coding provider in OpenCode). No additional configuration required.

The plugin queries two endpoints on `api.z.ai`:

- `GET /api/biz/subscription/list` — plan name, price, billing cycle, validity period, and auto-renew status
- `GET /api/monitor/usage/quota/limit` — usage windows with percentage used, remaining, and reset timestamps, plus per-model breakdowns

Reported windows map the API's unit codes to friendly labels: **Monthly** request quota (with used/total count), a **5-hour rolling** token window, and a **Weekly** token window — each with its own progress bar and reset countdown.

## Security & Privacy

`mystatus` is read-only and makes no changes to your system or accounts.

**Files read (never written):**

| File | Purpose |
|------|---------|
| `~/.local/share/opencode/auth.json` | OpenCode's official credential store |
| `~/.config/opencode/antigravity-accounts.json` | Antigravity plugin account store |
| `~/.config/opencode/opencode-go.json` | OpenCode Go dashboard config (optional) |
| `~/.config/opencode/copilot-quota-token.json` | Copilot PAT (optional) |
| `~/.config/opencode/poe-api-key.json` | Poe API key (optional) |

**Endpoints contacted (all first-party provider APIs):**

| Provider | Endpoint(s) |
|----------|-------------|
| OpenAI | `chatgpt.com/backend-api/wham/usage` |
| Anthropic | `api.anthropic.com/api/oauth/usage`, `console.anthropic.com/v1/oauth/token` |
| Google | `cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`, `oauth2.googleapis.com/token` |
| GitHub Copilot | `api.github.com/copilot_internal/*`, `api.github.com/users/*/settings/billing/premium_request/usage` |
| OpenCode Go | `opencode.ai/zen/go/v1/models`, `opencode.ai/workspace/*/go` |
| Poe | `api.poe.com/usage/current_balance` |
| Z.AI | `api.z.ai/api/biz/subscription/list`, `api.z.ai/api/monitor/usage/quota/limit` |

- Credentials are read locally and sent **only** to their own provider.
- Nothing is stored, cached, logged, or transmitted anywhere else.
- The full source is open for review.

> **Note:** Some provider usage endpoints are internal/undocumented and may change without notice. The plugin degrades gracefully — a failing platform reports an error and the others still render.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/
```

The plugin is a single self-contained module at `plugin/mystatus.ts`. Each platform is an independent `query*` function returning a `{ success, output | error }` result, run in parallel and collected into the final report — making it straightforward to add a new provider.

## Credits

A fork of [vbgate/opencode-mystatus](https://github.com/vbgate/opencode-mystatus), extended with Anthropic, GitHub Copilot, OpenCode Go (multi-account), Poe, multi-account Google, and Z.AI (GLM Coding Plan) support.

## License

MIT
