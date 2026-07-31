// Launch-at-login (todo 15).
//
// macOS and Windows use app.setLoginItemSettings; Linux has no equivalent so
// the call is a documented no-op that still reports ok so the UI toggle stays
// in sync with the persisted prefs value (mystatus-desktop.json). The prefs
// store owns the persisted boolean; this module owns the OS call.
//
// The deps seam lets tests mock app.setLoginItemSettings without booting
// Electron.

import type { App, Settings } from "electron";
import type { LoginItemResult, SetLoginItemRequest } from "../shared/ipc.js";

export interface LoginItemDeps {
  readonly platform: NodeJS.Platform;
  // Electron's `Settings` is the all-optional setLoginItemSettings input;
  // `LoginItemSettings` (all-required) is the getLoginItemSettings RETURN type.
  readonly setLoginItemSettings: (settings: Settings) => void;
}

function isSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32";
}

/**
 * Set the OS launch-at-login state. Never throws. On Linux the call is a
 * no-op that reports `supported: false` so the renderer can show a hint.
 */
export function setLoginItem(
  req: SetLoginItemRequest,
  deps: LoginItemDeps,
): LoginItemResult {
  const openAtLogin = req.openAtLogin === true;
  if (!isSupported(deps.platform)) {
    return { ok: true, supported: false, openAtLogin };
  }
  try {
    deps.setLoginItemSettings({ openAtLogin });
  } catch {
    // Best-effort: a failure to set the OS flag does not invalidate the
    // persisted prefs. Report the intended state so the UI stays in sync.
    return { ok: true, supported: true, openAtLogin };
  }
  return { ok: true, supported: true, openAtLogin };
}

// Production singleton wired to the real Electron app. Lazily imported so
// the module can be loaded under test (VITEST is set) without touching
// Electron.
let realDeps: LoginItemDeps | null = null;

export function getLoginItemDeps(app: App): LoginItemDeps {
  if (realDeps === null) {
    realDeps = {
      platform: process.platform,
      setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    };
  }
  return realDeps;
}

export function resetLoginItemDepsForTest(): void {
  realDeps = null;
}