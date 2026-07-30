# Learnings — desktop-app


## 2026-07-30 Plan start
- Core: plugin/mystatus.ts via ~core alias
- Dirty worktree MUST NOT be staged
- Tests MUST redirect HOME/USERPROFILE
- ESM main required; @opencode-ai/plugin is ESM-only
- threshold in mystatus-desktop.json not mystatus.json
- Tier functions private in tui.ts — vendor with golden fixtures

## 2026-07-30 Task 1 — scaffold
- electron-vite@5 peer: vite ^5||^6||^7 (NOT ^8). Pinned vite@^7.
- @vitejs/plugin-react@6 requires vite@^8; used @vitejs/plugin-react@^5.
- electron-vite hardcodes preload entryFileNames='[name].mjs' when format='es'
  (lib-q6ns0vZr.js:435-442). Main must reference ../preload/index.mjs.
- React 19: no global JSX namespace — import { type JSX } from "react".
- React 19: className not class. verbatimModuleSyntax: drop .tsx import ext.
- Shell does not import ~core yet, so alias-break failure test is deferred to
  todo 2 (core bridge) which actually exercises the alias.
- @opencode-ai/plugin externalized in main+preload rollup; survives packaging.
- Pre-existing dirty files (README, bin, dist, plugin) left untouched.

## 2026-07-30 Task 2 — core bridge + IPC contract
- ~core alias resolves at build time; main bundle is ESM (10 import/export,
  0 require). All 5 core fns (queryMyStatus, buildMyStatusViewModel,
  formatMyStatus, loadConfig, saveConfig) bundled from ../plugin/mystatus.ts.
- @opencode-ai/plugin stays external (1 ref = external decl, not inlined).
- core saveConfig silently swallows ENOENT (plugin/mystatus.ts:6745-6747):
  tests MUST pre-create ~/.config/opencode/ in the tmp HOME or patchConfig
  round-trip appears to no-op. Added mkdirSync in beforeAll.
- coreApi contract: every method resolves (never rejects). Errors arrive
  as {error: string} so the renderer needs no try/catch per call site.
- View model passed through verbatim — no wrapping/transformation.
- Preload bridge renamed onPush → onViewModel (task spec). App.tsx updated.
  ipcRenderer never leaked; only invoke + .on/.off on known channels.
- Shared types re-declared in ipc.ts (not re-exported from ~core) so the
  renderer type graph (tsconfig.web.json) can import the contract without
  pulling the core alias into the web project.
- registerIpc(ipcMain) mirrors registerShellIpc pattern: takes ipc as a
  param so unit tests can mock electron.ipcMain without booting Electron.

## 2026-07-30 Task 20 — prefs store + single-instance lock
- prefs.ts module-level CONFIG_DIR = join(homedir(), ".config", "opencode") resolves
  at IMPORT time. Tests MUST set HOME before `await import("./prefs.js")` — a static
  import would freeze the real homedir(). Used top-level await import in the test.
- mkdtempSync creates a NEW randomly-suffixed dir, NOT the path you pass — use
  mkdirSync(dir, {recursive: true}) to create a specific path. (Caught in first run.)
- Atomic write: writeFileSync(tmp, {mode:0o600}) then renameSync(tmp, path). On
  POSIX rename is atomic; on Windows it replaces the destination. No .tmp residue
  on success. ensureDir uses mode 0o700 for the config dir.
- Corrupt-file fallback: catch in loadPrefs returns {...DEFAULT_PREFS}; the corrupt
  file is LEFT IN PLACE (not overwritten) so the user can recover. coerce() defensively
  normalizes every field — invalid trendMode→undefined, non-boolean→default, etc.
- exactOptionalPropertyTypes: DesktopPrefs optional fields typed as `T | undefined`
  explicitly; WindowBounds uses readonly + explicit `| undefined` for x/y.
- Single-instance lock at TOP of bootstrap() (before any window creation) to
  minimize merge-conflict surface with parallel todos 2/4. Coexists with todo 2's
  registerIpc(ipcMain) in whenReady(). Lock-fail path: app.quit() + return.
- typecheck:node reports pre-existing errors in plugin/mystatus.ts (dirty kimi
  worktree) — NOT my files. Base typecheck (tsconfig.json) is clean. Plan forbids
  touching plugin/, so these are out of scope.
- core.test.ts (todo 2, parallel, uncommitted) fails 2 tests against plugin saveConfig
  silent-write behavior on dirty worktree — independent of this task.

## 2026-07-30 Task 4 — renderer shell
- PARALLEL COORDINATION: todo 2 (b53225d) + todo 20 (5e2c286) landed mid-task.
  Bridge API changed: onPush → onViewModel; PushPayload.model is
  ViewModelResult = MyStatusViewModel | {error}; staleConfig is boolean (not a
  config object); getConfig() typed MyStatusConfig. Adapted store; kept
  optional-chaining for `refresh` (todo 3, absent) via RendererBridge. Deleted
  my duplicate view-model mirror — viewmodel.ts now imports types from
  shared/ipc.ts and only owns runtime validation (isPushPayload/isViewModel).
- LATENT SCAFFOLD BUG, fixed here: preload built ESM (.mjs import) but window
  has sandbox:true → sandboxed preload is CJS-only → preload threw, window.mystatus
  undefined, renderer crashed (blank #root). Todo 1/2 never launched a renderer
  using the bridge, so it was invisible until e2e. Fix: preload = sole CJS target
  (electron.vite.config preload output format:"cjs", entry [name].js); main
  preload path .mjs → .js. Kept sandbox ON. electron-vite does NOT force .mjs
  when format:cjs (confirmed out/preload/index.js).
- HARDEN BOUNDARY: getBridge() returns undefined when preload absent;
  connectStatusStore degrades (no white screen). Unit-tested.
- STALE TSBUILDINFO TRAP: out/types/*.tsbuildinfo replays can hide the real
  node-program failure AND spuriously surface plugin errors in the web
  program. Always `rm -rf out/types` before trusting typecheck after a
  structural change. typecheck:web/typecheck/root clean after clear.
- typecheck:node pre-existing failure = todo 2's core.ts pulling ~core into the
  node program (plugin fails desktop's exactOptionalPropertyTypes etc.) + 4
  todo-1/2 file errors. Out of category + plugin untouchable → report only.
  Matches todo 20's note at the bottom of this file.
- TAILWIND v4: tokens via @theme; custom animations via --animate-* + top-level
  @keyframes; @apply works after @import "tailwindcss". CSP blocks web fonts →
  system sans + ui-monospace pairing (mono numerals with tabular-nums = on-subject
  for a TUI-born quota tool). Status tiers as tokens ok/warn/low/dead.
- E2E: _electron.launch built app needs ELECTRON_RENDERER_URL = pathToFileURL(
  out/renderer/index.html) because main's isDev branch calls loadURL (app not
  packaged). HOME/USERPROFILE → tmpdir (safety gate). Push via
  electronApp.evaluate(({BrowserWindow}, args) => win.webContents.send(...)).
  Staggered animate-rise (fill:both) is opacity:0 until its delay elapses →
  waitForTimeout before screenshots or evidence captures a mid-fade frame.
- DashboardPane renders model.health (NOT summary.health) — easy slip; health
  lives on the model, tally (green/yellow/red) on summary.

## 2026-07-30 Task 3 — polling service
- SINGLE-FLIGHT IS MANDATORY, not optional: core gives each provider a 15s deadline
  (plugin/mystatus.ts:7422) so a slow cycle can exceed a 60s interval, and two
  overlapping queryMyStatus calls both do read-modify-write on mystatus-cache.json
  + mystatus-history.json (plugin/mystatus.ts:6830-6843, 6945-6956) and would lose
  entries. The inFlight boolean guard + forcePending flag enforce this.
- FAKE-TIMER + FIRE-AND-FORGET DEADLOCK: the forceRefresh mid-flight test uses real
  timers because vitest fake timers cannot reliably drain the multi-level microtask
  chain spawned by `void this.fetch(true).then(resolver)` in the finally block.
  advanceTimersByTimeAsync fires the timer and flushes the first level of microtasks,
  but the finally→fetch(true)→getViewModel(resolve)→broadcast→resolver chain spans
  multiple microtask boundaries that are NOT drained. Awaiting the forceP promise
  before advancing timers deadlocks (forceP resolves only after the timer fires).
  Real timers + real microtasks make the chain deterministic. This is a known
  vitest fake-timer limitation with fire-and-forget promise chains in finally blocks.
- forceRefresh returns a Promise<void> that resolves only after the forced fetch
  broadcasts — not immediately. When in-flight, it stores a resolver; the finally
  block chains fetch(true).then(resolver). This lets the renderer's refresh() await
  completion and update UI state accordingly.
- Config re-read every tick: loadConfig() is cheap (sync file read + JSON.parse).
  The poller re-derives the interval and config signature each tick so external
  edits to watchIntervalSec take effect without a restart. staleConfig is flagged
  when JSON.stringify(cfg) changes between ticks (renderer re-fetches config).
- Polling gate: shouldPoll() = windows ≥ 1 OR trayAlive. When no audience, ticks
  reschedule at the configured interval but skip the fetch — polling resumes
  instantly when a window or the tray reappears. setTrayAlive(bool) is exposed
  for todo 16 (tray) but not wired here.
- broadcast() skips destroyed windows: BrowserWindow.getAllWindows() can include
  windows mid-close; win.isDestroyed() check prevents sending to a dead webContents.
- Singleton getPoller() is lazily constructed so importing poller.ts under VITEST
  does not touch Electron (BrowserWindow.getAllWindows). resetPollerForTest()
  clears the singleton + stops the timer for test isolation.
- CHANNELS.refresh added to shared/ipc.ts; preload exposes refresh() via
  ipcRenderer.invoke(CHANNELS.refresh); ipc.ts registers the handler →
  getPoller().forceRefresh(). Renderer bridge.ts: refresh is now required
  (not optional) on RendererBridge since todo 3 ships it.
