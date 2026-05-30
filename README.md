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

Reads all accounts from `~/.config/opencode/antigravity-accounts.json`. Tries a live API fetch (token refresh → `fetchAvailableModels`) and falls back to cached quota if the live call fails. Shows G3 Pro, G3 Image, G3 Flash, and Claude model quotas per account.

### GitHub Copilot

Two auth paths: (1) optional fine-grained PAT in `copilot-quota-token.json` for the public billing API, or (2) OAuth token from `auth.json` with automatic token exchange for the internal quota API. Shows Premium + Chat + Completions usage.

### OpenCode Go

Two modes: (a) simple API-key probe (`GET /models`) when only a key is available, or (b) full dashboard scraping for 5h/weekly/monthly quota windows when a workspace ID + browser auth cookie are configured via `~/.config/opencode/opencode-go.json`.

### Poe

Queries `api.poe.com/usage/current_balance` with a bearer token resolved from auth.json, `POE_API_KEY` env var, or `poe-api-key.json`. Shows monthly point balance, daily grants, and USD equivalent.

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
