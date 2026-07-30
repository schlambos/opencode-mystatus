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
  prefsGet: "mystatus:prefs:get",
  prefsPatch: "mystatus:prefs:patch",
  push: "mystatus:push",
  refresh: "mystatus:refresh",
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
}

declare global {
  interface Window {
    mystatus: Bridge;
  }
}

export {};