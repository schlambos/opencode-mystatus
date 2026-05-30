# opencode-mystatus

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

All-in-one AI quota status plugin for [OpenCode](https://opencode.ai). Query remaining quota across six platforms in one command.

## Supported Platforms

| Platform       | Account Type           | Data Source / Auth                                   |
|----------------|------------------------|------------------------------------------------------|
| OpenAI         | ChatGPT Plus/Team/Pro  | `~/.local/share/opencode/auth.json` → `openai`       |
| Anthropic      | Claude Pro/Max         | `~/.local/share/opencode/auth.json` → `anthropic`    |
| Google         | Antigravity free quota | `~/.config/opencode/antigravity-accounts.json`       |
| GitHub Copilot | Individual / Business  | `~/.local/share/opencode/auth.json` + optional PAT   |
| OpenCode Go    | Any Go subscription    | API key from auth.json + optional dashboard cookie   |
| Poe            | Subscription or paygo  | auth.json, `POE_API_KEY` env, or poe-api-key.json    |

## Installation

### From npm

Add to your `~/.config/opencode/opencode.json`:

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

### From local files

Copy `plugin/mystatus.ts` to `~/.config/opencode/plugin/` and `command/mystatus.md` to `~/.config/opencode/command/`, then restart OpenCode.

## Usage

- `/mystatus` slash command
- "Check my AI quota" / "How much Claude quota do I have left?"

## Platforms

### OpenAI

Reads the ChatGPT OAuth token from `auth.json` and calls `chatgpt.com/backend-api/wham/usage`. Shows 5-hour and 7-day rolling windows plus the plan type.

### Anthropic (Claude.ai)

Reads the Claude OAuth session from `auth.json`, performs automatic token refresh via the Claude Code OAuth client, and queries `api.anthropic.com/api/oauth/usage`. Shows 5-hour and 7-day rolling windows.

### Google (Antigravity)

Requires the [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) plugin to be installed and at least one account signed in. Reads accounts from `~/.config/opencode/antigravity-accounts.json`. Tries a live API fetch (token refresh → `fetchAvailableModels`) and falls back to cached quota if the live call fails. Shows G3 Pro, G3 Image, G3 Flash, and Claude model quotas per account.

### GitHub Copilot

Two auth paths:

**(1) Fine-grained PAT** — Create a fine-grained personal access token with **Plan → Read-only** permission at `https://github.com/settings/tokens?type=beta`. Save to `~/.config/opencode/copilot-quota-token.json`:

```json
{ "token": "github_pat_...", "username": "YourGitHubUsername", "tier": "pro" }
```

Valid `tier` values: `free` (50/mo), `pro` (300/mo), `pro+` (1500/mo), `business` (300/mo), `enterprise` (1000/mo). This calls the GitHub public billing API and shows aggregate premium request usage.

**(2) OAuth from auth.json** — Falls back to the OAuth token from `auth.json` → `github-copilot` with automatic token exchange. Works for accounts authenticated via OpenCode's Copilot provider. Shows Premium, Chat, and Completions breakdowns from the internal quota API.

### OpenCode Go

Two modes:

**(a) API-key probe** — If only an API key is present (from `auth.json` → `opencode-go`), the plugin calls `GET /zen/go/v1/models` to confirm reachability and list available models. Quota windows are not exposed by this endpoint.

**(b) Dashboard scraping** — For rolling 5h, weekly, and monthly quota windows, provide a workspace ID and browser auth cookie. The plugin fetches the SolidJS dashboard page at `opencode.ai/workspace/<id>/go` and parses the SSR hydration data.

Configure via `~/.config/opencode/opencode-go.json` in one of two shapes:

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

Or for a single account:

```json
{
  "workspaceId": "your_workspace_id",
  "authCookie": "the_auth_cookie_value"
}
```

Alternatively, set env vars `OPENCODE_GO_WORKSPACE_ID` and `OPENCODE_GO_AUTH_COOKIE`.

**Finding your workspace ID:** Open `https://opencode.ai/workspace` in a browser, select your Go workspace, and note the UUID in the URL: `https://opencode.ai/workspace/<uuid>/go`.

**Getting the auth cookie:** While logged in at `opencode.ai`, open DevTools → Application → Cookies → `opencode.ai` and copy the value of the `auth` cookie. This cookie expires when your browser session ends.

### Poe

Queries `api.poe.com/usage/current_balance` with a bearer token. The plugin resolves the token in this priority:

1. `access` or `refresh` token from `auth.json` → `poe` (Populated automatically if you use a Poe model in OpenCode.)
2. `POE_API_KEY` environment variable
3. `~/.config/opencode/poe-api-key.json`:

```json
{ "apiKey": "your_poe_api_key" }
```

To get a Poe API key, visit `https://poe.com/api_key` while logged in.

Output shows monthly point balance, daily grant countdown, and USD equivalent.

## Security

**Files accessed (read-only):**

- `~/.local/share/opencode/auth.json` — OpenCode's official auth storage
- `~/.config/opencode/antigravity-accounts.json` — Antigravity plugin's account storage
- `~/.config/opencode/opencode-go.json` — OpenCode Go dashboard config
- `~/.config/opencode/copilot-quota-token.json` — optional Copilot PAT config
- `~/.config/opencode/poe-api-key.json` — optional Poe API key file

**API endpoints (all official):**

- `chatgpt.com/backend-api/wham/usage` — OpenAI
- `api.anthropic.com/api/oauth/usage` — Anthropic
- `cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` — Google
- `api.github.com/copilot_internal/user` / `api.github.com/users/*/settings/billing/premium_request/usage` — GitHub Copilot
- `opencode.ai/zen/go/v1/models` / `opencode.ai/workspace/*/go` — OpenCode Go
- `api.poe.com/usage/current_balance` — Poe
- `oauth2.googleapis.com/token` / `console.anthropic.com/v1/oauth/token` — OAuth token refresh

**Privacy:**

- No data is stored, uploaded, or cached
- Source code is fully open for review

## Development

```bash
npm install
npm run typecheck
npm run build
```

## License

MIT
