# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
