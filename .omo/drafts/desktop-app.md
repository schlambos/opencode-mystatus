---
slug: desktop-app
status: plan-written
intent: clear
pending-action: user chooses — start work, or run high-accuracy dual-Momus review first
approach: Electron + electron-vite + React desktop app in `desktop/` importing plugin/mystatus.ts directly in the main process; in-app Chromium sign-in windows capture provider session cookies into the existing ~/.config/opencode/ cookie files; tray + low-quota notifications; full feature parity with one-shot CLI + watch TUI.
---

# Draft: desktop-app

## Components (topology ledger)
<!-- id | outcome (one line) | status | evidence path -->
- desktop-scaffold | electron-vite react-ts app in `desktop/`, main process imports core | active | desktop/package.json
- core-bridge | typed IPC API exposing queryMyStatus/buildMyStatusViewModel/loadConfig/saveConfig | active | desktop/src/main/*
- polling-service | main-process poll loop honoring watchIntervalSec/cacheTtlSec, pushes snapshots to renderer | active | desktop/src/main/poller.ts
- dashboard-ui | summary header, 3 horizon tabs, provider cards (meters/sparklines/countdowns), sort/threshold, hide/show, issues panel | active | desktop/src/renderer/*
- credential-manager | per-provider capture windows (isolated in-memory partitions) + guided paste for PAT/API-key providers, writes cookie JSON files, test-connection | active | desktop/src/main/capture.ts
- settings-ui | mystatus.json knobs editor + provider disabled/order + export (JSON/ANSI) | active | desktop/src/renderer/settings/*
- tray-notify | tray icon w/ status color, native notifications on threshold crossing, launch-at-login | active | desktop/src/main/tray.ts
- packaging | electron-builder dmg/nsis/AppImage + electron-updater via GitHub releases | active | desktop/electron-builder.yml

## Open assumptions (announced defaults)
<!-- assumption | adopted default | rationale | reversible? -->
- Frontend framework | React + TS + Tailwind (electron-vite react-ts template) | largest ecosystem, template-supported; user expressed no preference | yes
- App location | `desktop/` folder in this repo, self-contained package.json | keeps single repo/source of truth; no monorepo tooling needed | yes
- Core consumption | electron-vite main build compiles `../plugin/mystatus.ts` via alias; `@opencode-ai/plugin` added as desktop dependency | zero duplication; no core refactor required | yes
- Credential write target | always `~/.config/opencode/<file>` (same as plugin's configFile() write path) | plugin writes state there; reads fall back there | no (plugin contract)
- Secrets storage | plaintext JSON files (plugin's existing contract), never displayed unmasked by default; no OS keychain | plugin reads files; keychain would fork the credential contract | no
- auth.json editing | not exposed; OpenCode-owned, GUI shows read-only auth presence per provider | avoids corrupting OpenCode state | n/a
- Test strategy | tests-after; agent-executed QA via Playwright Electron driver + IPC-level node checks; repo has no existing test infra | greenfield app, UI-heavy | yes
- Distribution | electron-builder + electron-updater, GitHub releases (repo is not on npm) | matches existing install-from-repo model | yes

## Findings (cited - path:lines)
- Core is one 7,518-line ESM module: plugin/mystatus.ts; Node builtins (fs/os/path) + global fetch only; no TTY/native deps for query path (plugin/mystatus.ts:31-35).
- Exported API: queryMyStatus (7408), buildMyStatusViewModel (7328), formatMyStatus (7441), loadConfig (6730), saveConfig (6740), MyStatusPlugin (7496). View model types: MyStatusViewModel 7184, MyStatusViewProvider 7174, StatusIssue 7202, StatusHealth 7209.
- saveConfig is shallow-merge, non-atomic, best-effort (6740-6748); writes to legacy global ~/.config/opencode/ via configFile() (6673-6678). Reads search OPENCODE_CONFIG_DIR, opencode-multi profiles, then legacy dir (394-416).
- mystatus.json shape (MyStatusConfig 6640-6671): width, layout, sort, summary, trend, cacheTtlSec, historyMax, historyMinIntervalSec, watchIntervalSec, uiRefreshSec, providers.{disabled,hidden,order}, google.excludeEmails, antigravityTools.{enabled,baseUrl,apiKey,adminPassword,usageHours,includeUsage}.
- 10 credential files, all currently read-only to the plugin: atlas-cookies.json {cookie, accountUuid?} (5004-5091); byteplus-cookies.json {cookie}; mistral-cookies.json {cookie,alias?}|{accounts[]} needs csrftoken in string (4720); ollama-cookies.json {cookie} needs __Secure-session (5549); longcat-cookies.json {passportToken, region}|{cookie} (5645-5706); qwencloud-cookies.json {ticket, aliyunPk, isg, esmTicket?}|{cookie} (4237-4330); stepfun-cookies.json {oasisToken, oasisWebid, sessionToken?} (4011-4087); opencode-go.json {workspaceId, authCookie}|{accounts[]} (2630-2667); copilot-quota-token.json {token, username, tier}; poe-api-key.json {apiKey}.
- TUI horizon classification: windowTier/windowsForView (plugin/tui.ts:304-370); hidden persisted to providers.hidden (tui.ts:781-788, 860-874); issues pane kinds error/stale/unconfigured; density auto/detail/compact; poll = queryMyStatus + buildMyStatusViewModel (tui.ts:833-839).
- CLI flags: format/threshold/width/layout/sort/summary/trend/only/exclude/fresh/watch/interval (bin/mystatus-cli.ts:9-47). JSON output schema: cellsToJson (plugin/mystatus.ts:6394-6417).
- Electron v43 current stable; ESM main supported since v28; Tray API built-in; session.fromPartition in-memory when no persist: prefix; ses.cookies.get returns HttpOnly cookies; clearStorageData/clearCache/clearAuthCache exist; security defaults (sandbox, contextIsolation, no nodeIntegration) all secure by default; setWindowOpenHandler for OAuth popups in same partition; will-navigate guard for domain allowlist; ses.setUserAgent for bot-detection (electronjs.org/docs/latest/api/{session,cookies,browser-window,web-contents,tray}, tutorial/security).
- Dirty worktree: uncommitted changes in plugin/mystatus.ts (+1263), plugin/tui.ts (+896), README, bin, dist — includes new `kimi` provider already in PROVIDERS registry (plugin/mystatus.ts:6783). GUI consumes working-tree core.

## Decisions (with rationale)
- STACK: Electron (user-chosen). Direct TS import of core in main process — no IPC serialization of provider fetch logic, tray + updater built in, least new code. (Alternatives rejected: Tauri+sidecar adds Rust shell + JSON-stdout contract; bun+webview lacks tray/packaging.)
- CREDENTIALS: in-app sign-in capture (user-chosen pivot). Per-provider capture window with isolated in-memory partition, navigation allowlist, sentinel-cookie polling + did-navigate workspaceId detection, then write plugin-format JSON and wipe partition. Copilot PAT + Poe API key remain guided paste (not cookies).
- BACKGROUND: tray + notifications (user-chosen).
- PARITY BAR: every one-shot arg + every TUI capability has a GUI home; TUI-only artifacts (density modes, key bindings) intentionally not ported — GUI supersedes with real controls.

## Scope IN
- desktop/ Electron app: dashboard (3 horizons, summary, hide/show, issues, sort, threshold, trends, countdowns), credential manager (capture + paste + test + expiry surfacing), settings (all mystatus.json knobs), export (JSON/ANSI), tray + notifications + launch-at-login, packaging for mac/win/linux.
- Zero functional changes to plugin core, CLI, TUI (additive only; at most a type-only re-export if needed).

## Scope OUT (Must NOT have)
- No edits to auth.json or ~/.grok/auth.json (plugin/OpenCode-owned write paths).
- No OS keychain / new credential formats; no cloud sync; no account creation flows beyond sign-in capture.
- No changes to existing one-shot output, TUI, or CLI behavior.
- No web/mobile versions; no remote (multi-machine) monitoring.

## Open questions
- None blocking. (Bot-detection on specific portals is a runtime risk mitigated by UA spoof + interactive challenge passthrough.)

## Approval gate
status: awaiting-approval
pending action: write .omo/plans/desktop-app.md (6 waves: scaffold+bridge, polling data layer, dashboard UI, credential capture manager, settings+export, tray+notifications+packaging; then final verification wave)
