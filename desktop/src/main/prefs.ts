// Desktop-only preferences store.
//
// Lives at ~/.config/opencode/mystatus-desktop.json — a SEPARATE file from the
// plugin's mystatus.json. Holds ONLY desktop concerns that have no home in
// MyStatusConfig: `threshold` (args-only in the core, plugin/mystatus.ts:7273),
// the UI's trend-mode override, notification settings, last tab, window
// bounds, and launch-at-login. Credentials and provider data are NEVER stored
// here; sort/summary/trend/intervals stay in mystatus.json.
//
// Atomic write: write to <file>.tmp (mode 0o600) then rename. A crash mid-write
// leaves the previous file intact. Corrupt JSON on load falls back to defaults
// without throwing — the corrupt file is left in place so the user can recover.

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DesktopPrefs, TrendMode, WindowBounds } from "../shared/ipc.js";

export type { DesktopPrefs, TrendMode, WindowBounds };

export const DEFAULT_PREFS: DesktopPrefs = {
  threshold: 25,
  trendMode: undefined,
  notifications: true,
  notifyCooldownMin: 60,
  lastTab: undefined,
  windowBounds: undefined,
  launchAtLogin: false,
} as const;

const PREFS_FILE = "mystatus-desktop.json";
const CONFIG_DIR = join(homedir(), ".config", "opencode");

/** Resolve the prefs file path. Exposed for tests and the UI footer. */
export function prefsPath(): string {
  return join(CONFIG_DIR, PREFS_FILE);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerce(raw: unknown): DesktopPrefs {
  if (!isPlainObject(raw)) return { ...DEFAULT_PREFS };
  const r = raw;
  const trend = r["trendMode"];
  const validTrend: TrendMode | undefined =
    trend === "off" || trend === "compact" || trend === "full" ? trend : undefined;
  const wb = r["windowBounds"];
  const bounds: WindowBounds | undefined = isPlainObject(wb)
    ? {
        x: typeof wb["x"] === "number" ? wb["x"] : undefined,
        y: typeof wb["y"] === "number" ? wb["y"] : undefined,
        width: typeof wb["width"] === "number" ? wb["width"] : 0,
        height: typeof wb["height"] === "number" ? wb["height"] : 0,
      }
    : undefined;
  return {
    threshold: typeof r["threshold"] === "number" ? r["threshold"] : DEFAULT_PREFS.threshold,
    trendMode: validTrend,
    notifications: typeof r["notifications"] === "boolean" ? r["notifications"] : DEFAULT_PREFS.notifications,
    notifyCooldownMin:
      typeof r["notifyCooldownMin"] === "number" ? r["notifyCooldownMin"] : DEFAULT_PREFS.notifyCooldownMin,
    lastTab: typeof r["lastTab"] === "string" ? r["lastTab"] : undefined,
    windowBounds: bounds,
    launchAtLogin:
      typeof r["launchAtLogin"] === "boolean" ? r["launchAtLogin"] : DEFAULT_PREFS.launchAtLogin,
  };
}

/** Load prefs, merged with defaults. Corrupt/missing file ⇒ defaults, never throws. */
export function loadPrefs(): DesktopPrefs {
  const path = prefsPath();
  try {
    const text = readFileSync(path, "utf8");
    return coerce(JSON.parse(text));
  } catch {
    // Missing file (first run) or corrupt JSON — fall back to defaults.
    return { ...DEFAULT_PREFS };
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Atomic write: tmp file (0o600) in the same dir, then rename. */
export function savePrefs(prefs: DesktopPrefs): void {
  const path = prefsPath();
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + "\n", { mode: 0o600 });
  // rename is atomic on POSIX; on Windows it replaces the destination.
  renameSync(tmp, path);
  // Verify-after-write (same contract as config-io / cred-files / paste-creds):
  // re-read and deep-compare so the UI never reports a false "Saved".
  const reread: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (JSON.stringify(reread) !== JSON.stringify(prefs)) {
    throw new Error(`verify-after-write mismatch for ${path}`);
  }
}

/** Read-modify-write. Returns the merged result. */
export function patchPrefs(patch: Partial<DesktopPrefs>): DesktopPrefs {
  const next: DesktopPrefs = { ...loadPrefs(), ...patch };
  savePrefs(next);
  return next;
}