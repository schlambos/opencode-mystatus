// Gated auto-update stub.
//
// electron-updater is wired here but is DISABLED by default. macOS
// auto-update requires a signed + notarized build; the unsigned artifacts
// this plan produces would fail noisily if autoUpdater were enabled
// unconditionally. The gate below only activates when the app is packaged
// AND an explicit opt-in env var (MYSTATUS_ENABLE_UPDATES=1) is set, so a
// future signed release can flip it on without a code change.
//
// MUST NOT enable auto-update by default. MUST NOT fabricate signing
// config. This module is a no-op in dev and in unsigned packaged builds.

import { app } from "electron";

const UPDATES_ENV = "MYSTATUS_ENABLE_UPDATES";

function isUpdatesEnabled(): boolean {
  // Gate 1: only in a packaged app. Dev builds never auto-update.
  if (!app.isPackaged) return false;
  // Gate 2: explicit opt-in. Unsigned builds stay off by default.
  return process.env[UPDATES_ENV] === "1";
}

export interface UpdaterHandle {
  readonly enabled: boolean;
  start(): void;
  stop(): void;
}

class DisabledUpdater implements UpdaterHandle {
  readonly enabled = false;
  start(): void {}
  stop(): void {}
}

class EnabledUpdater implements UpdaterHandle {
  readonly enabled = true;
  start(): void {
    // Lazy dynamic import keeps the test harness (which sets VITEST and
    // mocks electron) from loading electron-updater's real native bits,
    // and avoids importing electron-updater in dev/unsigned builds. The
    // main process is ESM ("type": "module"), so a static top-level
    // import would pull electron-updater into every boot — including the
    // test harness — which is why this is dynamic and gated.
    void import("electron-updater")
      .then((mod) => {
        const updater = mod.autoUpdater;
        // Do NOT auto-download or auto-install. A future signed release can
        // prompt the user; for now we only check so the wiring is proven.
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        void updater.checkForUpdates();
      })
      .catch(() => {
        // Swallow: a failed update check in a gated build must never crash
        // the app. electron-updater logs internally.
      });
  }
  stop(): void {
    // electron-updater has no explicit teardown; nothing to do.
  }
}

/**
 * Build the updater handle for the current process. Returns a disabled
 * no-op unless both gates pass (packaged + MYSTATUS_ENABLE_UPDATES=1).
 */
export function createUpdater(): UpdaterHandle {
  if (!isUpdatesEnabled()) return new DisabledUpdater();
  return new EnabledUpdater();
}