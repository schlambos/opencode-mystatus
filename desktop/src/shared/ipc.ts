// Shared IPC contract between main, preload, and renderer.
//
// Channel names are string literals so the preload bridge and the main
// handlers cannot drift. Request/response payloads mirror the plugin
// core types (plugin/mystatus.ts) verbatim — the desktop app MUST NOT
// wrap or transform the view model; it passes MyStatusViewModel through
// unchanged so the renderer renders exactly what the core produced.

// ---------------------------------------------------------------------------
// Channel names
// ---------------------------------------------------------------------------

export const CHANNELS = {
  ping: "mystatus:ping",
  viewmodel: "mystatus:viewmodel",
  export: "mystatus:export",
  configGet: "mystatus:config:get",
  configPatch: "mystatus:config:patch",
  configInspect: "mystatus:config:inspect",
  configSave: "mystatus:config:save",
  configReset: "mystatus:config:reset",
  reveal: "mystatus:reveal",
  prefsGet: "mystatus:prefs:get",
  prefsPatch: "mystatus:prefs:patch",
  push: "mystatus:push",
  refresh: "mystatus:refresh",
  history: "mystatus:history",
  capture: "mystatus:capture",
  authStatus: "mystatus:auth:status",
  pasteCopilot: "mystatus:paste:copilot",
  pastePoe: "mystatus:paste:poe",
  clearCredential: "mystatus:cred:clear",
  writeCredential: "mystatus:cred:write",
  testProvider: "mystatus:cred:test",
  processCapture: "mystatus:cred:process-capture",
  openExternal: "mystatus:open:external",
  exportSave: "mystatus:export:save",
  loginItem: "mystatus:login-item",
  envAntigravity: "mystatus:env:antigravity",
} as const;

// ---------------------------------------------------------------------------
// Mirrored core types (plugin/mystatus.ts)
// ---------------------------------------------------------------------------
// These are re-declared here rather than re-exported from `~core` so the
// renderer (which is bundled without the core alias in its type graph) can
// import the contract. They are kept structurally identical to the plugin
// interfaces; the core.test.ts suite asserts structural compatibility by
// round-tripping real core output through these types.

export interface MyStatusArgs {
  format?: string;
  threshold?: number;
  width?: number;
  layout?: string;
  sort?: string;
  summary?: boolean;
  trend?: string;
  only?: string;
  exclude?: string;
  fresh?: boolean;
}

export interface MyStatusViewWindow {
  label: string;
  remaining: number;
  resetMs?: number;
}

export interface MyStatusViewProvider {
  name: string;
  minRemaining: number;
  soonestResetMs?: number;
  windows: MyStatusViewWindow[];
  note?: string;
  stale?: { ageMs: number; reason?: string };
}

export interface StatusIssue {
  provider: string;
  kind: "error" | "stale" | "unconfigured";
  detail: string;
  ageMs?: number;
}

export interface StatusHealth {
  queried: number;
  rendered: number;
  stale: number;
  failed: number;
  unconfigured: number;
}

export interface MyStatusViewModel {
  summary: {
    accounts: number;
    green: number;
    yellow: number;
    red: number;
    lowest?: { provider: string; label: string; remaining: number };
    soonest?: { provider: string; label: string; resetMs: number };
  };
  providers: MyStatusViewProvider[];
  errors: string[];
  alerts: string[];
  threshold: number;
  issues: StatusIssue[];
  health: StatusHealth;
}

export interface MyStatusConfig {
  width?: number;
  layout?: string;
  sort?: "urgency" | "name" | "reset";
  summary?: boolean;
  trend?: "off" | "compact" | "full";
  cacheTtlSec?: number;
  historyMax?: number;
  historyMinIntervalSec?: number;
  watchIntervalSec?: number;
  uiRefreshSec?: number;
  providers?: { disabled?: string[]; hidden?: string[]; order?: string[] };
  google?: { excludeEmails?: string[] };
  antigravityTools?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    adminPassword?: string;
    usageHours?: number;
    includeUsage?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Request / response payloads
// ---------------------------------------------------------------------------

/** Result of getViewModel / push — never throws; errors arrive as {error}. */
export type ViewModelResult = MyStatusViewModel | { error: string };

/** Push payload from main → renderer when a poll completes (todo 3). */
export interface PushPayload {
  model: ViewModelResult;
  fetchedAt: number;
  nextFetchAt: number;
  staleConfig?: boolean;
}

/** Export request: format selects json or ansi text. */
export interface ExportRequest {
  format: "json" | "ansi";
  args?: MyStatusArgs;
}

export interface ExportResponse {
  format: "json" | "ansi";
  text: string;
}

/** Config patch: shallow-merged into mystatus.json by core saveConfig. */
export type ConfigPatch = Partial<MyStatusConfig>;

// ---------------------------------------------------------------------------
// Settings page config IO (todo 14)
// ---------------------------------------------------------------------------
// Whole-section saves from the Settings page go through mystatus:config:save,
// which performs an atomic read-modify-write with verify-after-write (main's
// config-io.ts) instead of the core's shallow-merge saveConfig. inspect
// distinguishes a corrupt mystatus.json from a missing one so the page can
// show a recoverable error state and REFUSE to overwrite until the user fixes
// the file or explicitly resets it.

/**
 * Strict read result for mystatus.json. `missing` = file absent (first run);
 * `corrupt` = file exists but is unparseable even after JSONC comment
 * stripping — saves must be refused until fixed or explicitly reset.
 */
export type ConfigStatus =
  | { readonly status: "missing"; readonly path: string }
  | { readonly status: "corrupt"; readonly path: string; readonly error: string }
  | { readonly status: "ok"; readonly path: string; readonly config: MyStatusConfig };

/** Files the reveal IPC may show in the OS file manager (strict allowlist). */
export type RevealTarget = "config" | "prefs";

// ---------------------------------------------------------------------------
// Capture-window service (todo 10)
// ---------------------------------------------------------------------------
// `captureSession` opens an isolated in-memory BrowserWindow, lets the user
// sign in to a provider portal, detects completion via sentinel cookies
// (and optionally a URL pattern), extracts cookies BEFORE close, then ALWAYS
// wipes the partition. The spec is declarative so per-provider configs
// (todo 11) can be authored without touching the capture engine.

export interface CaptureSpec {
  /** In-memory partition id (NO `persist:` prefix). */
  readonly partitionId: string;
  /** Portal URL to load first. */
  readonly startUrl: string;
  /** Origins the portal may navigate to (the portal itself + its assets). */
  readonly allowedOrigins: readonly string[];
  /** Federated IdP origins (accounts.google.com, github.com, …) for SSO. */
  readonly idpOrigins: readonly string[];
  /** Cookie names whose presence signals a successful sign-in. */
  readonly sentinelCookies: readonly string[];
  /** Optional URL pattern for completion detection (e.g. opencode-go /workspace/<uuid>). */
  readonly urlPattern?: RegExp;
  /** Hard timeout in ms; resolves with status 'timeout' when reached. */
  readonly timeoutMs: number;
}

export interface CapturedCookie {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  expirationDate?: number;
}

export type CaptureStatus = "ok" | "timeout" | "cancelled" | "fallback";

export interface CaptureResult {
  readonly status: CaptureStatus;
  /** Cookies extracted for the spec URL (present on 'ok'; empty otherwise). */
  readonly cookies: readonly CapturedCookie[];
  /** Last navigated URL (for urlPattern-derived fields like workspaceId). */
  readonly finalUrl?: string;
  /** When status === 'fallback': the portal URL to open externally. */
  readonly fallbackUrl?: string;
  /** Human-readable detail (timeout reason, cancel reason, etc.). */
  readonly detail?: string;
}

/** IPC request for mystatus:capture. */
export type CaptureRequest = CaptureSpec;

// ---------------------------------------------------------------------------
// Guided paste (todo 12) — Copilot PAT + Poe API key
// ---------------------------------------------------------------------------
// These providers do NOT use browser cookie capture. The user pastes a token
// (Copilot fine-grained PAT) or an API key (Poe) into a masked field and the
// main process writes the exact plugin JSON schema to ~/.config/opencode/.
// Deep links to the provider's token-management page are opened via
// shell.openExternal through a dedicated IPC so the renderer never imports
// the Electron shell directly.

/** Copilot PAT payload — writes copilot-quota-token.json {token, username, tier}. */
export interface CopilotPastePayload {
  readonly token: string;
  readonly username: string;
  readonly tier: CopilotTier;
}

/** Poe API key payload — writes poe-api-key.json {apiKey}. */
export interface PoePastePayload {
  readonly apiKey: string;
}

export type CopilotTier = "pro" | "pro+" | "max";

/** Result of a paste write: {ok} on success, {ok:false, error} on validation/write failure. */
export type PasteResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/** Result of clearing a credential file. */
export type ClearResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * Result of an atomic credential write (todo 13). The path is the resolved
 * write target (profile-aware — overwrites the existing readable copy if one
 * exists, else the legacy ~/.config/opencode/ dir).
 */
export type CredentialWriteResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * Result of a test-connection call (todo 13). `ok` when the fresh
 * single-provider query produced no error/stale issue for that provider;
 * `ok:false` with the issue detail otherwise.
 */
export type TestProviderResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Result of the capture → extract → write → test flow (todo 13). `ok` with
 * the write path and test result on success; `ok:false` with the failing
 * stage and error on failure.
 */
export type CaptureWriteFlowResult =
  | {
      readonly ok: true;
      readonly writePath: string;
      readonly test: TestProviderResult;
    }
  | { readonly ok: false; readonly error: string; readonly stage: "extract" | "write" | "test" };

/**
 * auth:status response — reports which provider ids have a readable auth.json
 * entry OR a credential file present. NEVER returns token values; only the
 * provider-id presence map. The renderer regex-scans the serialized payload
 * to assert no secret prefixes leak through.
 */
export interface AuthStatus {
  /** Provider ids with a readable auth.json entry (OAuth providers). */
  readonly authJson: readonly string[];
  /** Provider ids with a readable credential file under ~/.config/opencode/. */
  readonly credentialFiles: readonly string[];
}

/** Open-external request: opens a URL in the user's default browser. */
export interface OpenExternalRequest {
  readonly url: string;
}

/**
 * Antigravity Tools env + auto-discovery status (todo 22).
 *
 * Reports ONLY booleans — which `ANTIGRAVITY_TOOLS_*` env vars are SET and
 * whether `~/.antigravity_tools/gui_config.json` was found. NEVER returns env
 * var VALUES over IPC; the renderer regex-scans the serialized payload to
 * assert no secret prefixes leak through. The auto-discovery result is
 * read-only: the desktop app never writes to gui_config.json.
 */
export interface AntigravityEnvStatus {
  /** True when `ANTIGRAVITY_TOOLS_BASE_URL` is set in the launch env. */
  readonly baseUrlFromEnv: boolean;
  /** True when `ANTIGRAVITY_TOOLS_API_KEY` is set in the launch env. */
  readonly apiKeyFromEnv: boolean;
  /** True when `ANTIGRAVITY_TOOLS_ADMIN_PASSWORD` is set in the launch env. */
  readonly adminPasswordFromEnv: boolean;
  /** True when `ANTIGRAVITY_TOOLS_USAGE_HOURS` is set in the launch env. */
  readonly usageHoursFromEnv: boolean;
  /** True when `~/.antigravity_tools/gui_config.json` exists (read-only). */
  readonly guiConfigFound: boolean;
  /** Absolute path checked for gui_config.json (for the UI status line). */
  readonly guiConfigPath: string;
}

/**
 * Credential file names the desktop app is allowed to write/clear. Includes
 * the paste providers (todo 12) and the cookie-capture providers (todo 11).
 * The writer (todo 13) resolves the write path profile-aware via
 * resolveCredentialWritePath.
 *
 * The runtime list is the SINGLE SOURCE OF TRUTH: the type is derived from
 * it, and the IPC boundary enforces it at runtime (renderer input is
 * untrusted — a compromised renderer must not be able to write or delete
 * arbitrary files under ~/.config/opencode/, e.g. opencode.json).
 */
export const CREDENTIAL_FILE_NAMES = [
  "copilot-quota-token.json",
  "poe-api-key.json",
  "atlas-cookies.json",
  "byteplus-cookies.json",
  "mistral-cookies.json",
  "ollama-cookies.json",
  "longcat-cookies.json",
  "qwencloud-cookies.json",
  "stepfun-cookies.json",
  "opencode-go.json",
] as const;

export type CredentialFileName = (typeof CREDENTIAL_FILE_NAMES)[number];

/** Runtime allowlist check for renderer-supplied credential file names. */
export function isCredentialFileName(name: unknown): name is CredentialFileName {
  return (
    typeof name === "string" &&
    (CREDENTIAL_FILE_NAMES as readonly string[]).includes(name)
  );
}

// ---------------------------------------------------------------------------
// Export-to-file (todo 15)
// ---------------------------------------------------------------------------
// The dashboard overflow menu offers "Copy JSON" / "Save JSON…" / "Copy card
// text" / "Save text…". Copy paths go through the renderer's clipboard; save
// paths go through this IPC so the main process owns the native save dialog
// (dialog.showSaveDialog) and the filesystem write. The export payload itself
// comes from coreApi.getJsonExport / getAnsiExport (todo 2) — the main process
// never spawns bin/mystatus.

/** Request to save an export to a file chosen via the native save dialog. */
export interface SaveExportRequest {
  /** "json" or "ansi" — selects coreApi.getJsonExport / getAnsiExport. */
  readonly format: "json" | "ansi";
  /** Per-call args forwarded to the core (threshold, sort, trend, …). */
  readonly args?: MyStatusArgs;
}

/**
 * Result of a save-export call. `ok` with the chosen path on success;
 * `ok:false` with `cancelled: true` when the user dismissed the save dialog
 * (no error toast); `ok:false` with `error` when the export or write failed.
 */
export type SaveExportResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Launch-at-login (todo 15)
// ---------------------------------------------------------------------------
// macOS/Windows use app.setLoginItemSettings; Linux has no equivalent so the
// call is a documented no-op that still reports ok so the UI toggle stays in
// sync with the persisted prefs value.

/** Request to set the launch-at-login state. */
export interface SetLoginItemRequest {
  readonly openAtLogin: boolean;
}

/** Result of a setLoginItem call. `supported` is false on Linux. */
export interface LoginItemResult {
  readonly ok: true;
  readonly supported: boolean;
  readonly openAtLogin: boolean;
}

// ---------------------------------------------------------------------------
// Desktop-only prefs (mystatus-desktop.json — NOT mystatus.json)
// ---------------------------------------------------------------------------
// `threshold` is NOT a MyStatusConfig key — the core reads it only from
// per-call args (plugin/mystatus.ts:7273), so it persists here and is passed
// into every getViewModel call as args.threshold. Types live in this shared
// module so the renderer can import them without pulling node:fs from
// main/prefs.ts into the renderer bundle.

export type TrendMode = "off" | "compact" | "full";

export interface WindowBounds {
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly width: number;
  readonly height: number;
}

export interface DesktopPrefs {
  readonly threshold: number;
  /** UI override; `undefined` defers to mystatus.json `trend`. */
  readonly trendMode: TrendMode | undefined;
  readonly notifications: boolean;
  readonly notifyCooldownMin: number;
  readonly lastTab: string | undefined;
  readonly windowBounds: WindowBounds | undefined;
  readonly launchAtLogin: boolean;
}

/** Prefs patch: read-modify-write merged into mystatus-desktop.json. */
export type PrefsPatch = Partial<DesktopPrefs>;

// Trend history mirrors the core's internal HistoryFile shape
// (plugin/mystatus.ts:6936-6943). Values are keyed "<cellTitle>::<label>"
// (plugin/mystatus.ts:7046). Read-only to the desktop app — it never writes
// this file.
export interface HistorySnapshot {
  ts: number;
  values: Record<string, number>;
}

export interface HistoryResponse {
  version: number;
  snapshots: HistorySnapshot[];
}

// ---------------------------------------------------------------------------
// Preload bridge surface
// ---------------------------------------------------------------------------

export interface Bridge {
  ping: () => Promise<unknown>;
  getViewModel: (args?: MyStatusArgs) => Promise<ViewModelResult>;
  getExport: (req: ExportRequest) => Promise<ExportResponse>;
  getConfig: () => Promise<MyStatusConfig>;
  patchConfig: (patch: ConfigPatch) => Promise<MyStatusConfig>;
  /** Read desktop-only prefs from mystatus-desktop.json (todo 20 store). */
  getPrefs: () => Promise<DesktopPrefs>;
  /** Merge a patch into mystatus-desktop.json and return the result. */
  patchPrefs: (patch: PrefsPatch) => Promise<DesktopPrefs>;
  /** Subscribe to pushed view models from the poller (todo 3). */
  onViewModel: (cb: (payload: PushPayload) => void) => () => void;
  /** Force an out-of-schedule refresh from the poller (todo 3). */
  refresh: () => Promise<void>;
  /** Read the core's trend history file (todo 7). Read-only; empty on any failure. */
  getHistory: () => Promise<HistoryResponse>;
  /** Open an isolated capture window for a provider portal (todo 10). */
  capture: (spec: CaptureRequest) => Promise<CaptureResult>;
  /** Report provider-id presence in auth.json + credential files (todo 12). No secrets. */
  getAuthStatus: () => Promise<AuthStatus>;
  /** Write Copilot PAT to copilot-quota-token.json (todo 12). */
  pasteCopilot: (payload: CopilotPastePayload) => Promise<PasteResult>;
  /** Write Poe API key to poe-api-key.json (todo 12). */
  pastePoe: (payload: PoePastePayload) => Promise<PasteResult>;
  /** Delete a credential file by name (todo 12). */
  clearCredential: (name: CredentialFileName) => Promise<ClearResult>;
  /**
   * Atomically write a credential file (todo 13). The path is resolved
   * profile-aware (overwrites the existing readable copy if one exists, else
   * the legacy ~/.config/opencode/ dir). Verify-after-write is mandatory.
   */
  writeCredential: (
    name: CredentialFileName,
    data: Record<string, unknown>,
  ) => Promise<CredentialWriteResult>;
  /**
   * Test a single provider by running a fresh query (todo 13). Returns
   * {ok} or {ok:false, error} from that provider's issues/errors.
   */
  testProvider: (providerId: string) => Promise<TestProviderResult>;
  /**
   * Run extract → write → test for a captured cookie session (todo 13).
   * The renderer calls capture(spec) first, then this with the result.
   * Returns the combined flow result; the renderer then calls refresh().
   */
  processCapture: (
    providerId: string,
    capture: CaptureResult,
  ) => Promise<CaptureWriteFlowResult>;
  /** Open a URL in the user's default browser via shell.openExternal (todo 12). */
  openExternal: (url: string) => Promise<void>;
  /** Strict read of mystatus.json for the Settings page (todo 14): reports corrupt vs missing. */
  inspectConfig: () => Promise<ConfigStatus>;
  /**
   * Atomic read-modify-write of mystatus.json for whole-section saves
   * (todo 14). Refuses while the file is corrupt and rejects partially-formed
   * `providers` payloads. Returns the merged config.
   */
  saveConfigSections: (sections: ConfigPatch) => Promise<MyStatusConfig>;
  /** Overwrite a corrupt/missing mystatus.json with `{}` (todo 14). Refused when the file parses. */
  resetConfig: () => Promise<MyStatusConfig>;
  /** Show mystatus.json or mystatus-desktop.json in the OS file manager (todo 14). */
  revealPath: (target: RevealTarget) => Promise<void>;
  /**
   * Report which ANTIGRAVITY_TOOLS_* env vars are SET (booleans only, never
   * values) and whether ~/.antigravity_tools/gui_config.json was found
   * (read-only). Powers the "from env" badges and auto-discovery status line
   * in the Antigravity Tools settings section (todo 22).
   */
  getAntigravityEnvStatus: () => Promise<AntigravityEnvStatus>;
  /**
   * Save an export to a file via the native save dialog (todo 15). The main
   * process runs coreApi.getJsonExport / getAnsiExport, prompts with
   * dialog.showSaveDialog, and writes the file. Cancelled is not an error.
   */
  saveExport: (req: SaveExportRequest) => Promise<SaveExportResult>;
  /**
   * Set the OS launch-at-login state (todo 15). macOS/Windows use
   * app.setLoginItemSettings; Linux is a documented no-op that still reports
   * ok so the persisted prefs toggle stays in sync.
   */
  setLoginItem: (req: SetLoginItemRequest) => Promise<LoginItemResult>;
}

declare global {
  interface Window {
    mystatus: Bridge;
  }
}

export {};