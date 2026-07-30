// System tray with status indicator (todo 16).
//
// Wraps Electron's Tray + Menu. The tray icon reflects the worst provider
// status from the latest pushed view model, mirroring the plugin's color
// semantics (plugin/mystatus.ts:48-60): red ≤0 or <threshold, yellow
// <50, green ≥50, gray when no provider has reported. The context menu
// offers Show Dashboard / Refresh Now / Issues (count) / Quit. Left-click
// toggles the main window (show+focus / hide).
//
// The tray keeps the app alive on darwin: when it exists, window-all-closed
// does NOT quit. setTrayAlive(true) is called on the poller so polling
// continues with no windows open.
//
// Pure-logic helpers (statusForModel, trayIconPath, buildMenuTemplate) are
// exported for unit testing with vi.mock('electron') — no real Electron
// Tray/Menu is constructed in tests.

import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MyStatusViewModel,
  PushPayload,
  ViewModelResult,
} from "../shared/ipc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TrayStatus = "green" | "yellow" | "red" | "gray";

export interface TrayDeps {
  readonly getWindows: () => BrowserWindow[];
  readonly createWindow: () => void;
  readonly refresh: () => Promise<void>;
  readonly quit: () => void;
  readonly iconDir: string;
}

/**
 * Derive the worst status from a view model. Mirrors the plugin's
 * colorForPercent thresholds (plugin/mystatus.ts:48-53): red when any
 * provider is at/below 0 or below the model's threshold, yellow when
 * below 50, green otherwise. Gray when no providers reported (error
 * model or zero providers).
 */
export function statusForModel(model: ViewModelResult): TrayStatus {
  if ("error" in model) return "gray";
  const vm: MyStatusViewModel = model;
  if (vm.providers.length === 0) return "gray";
  const threshold = vm.threshold;
  let worst: TrayStatus = "green";
  for (const p of vm.providers) {
    const r = p.minRemaining;
    if (r <= 0 || r < threshold) {
      return "red";
    }
    if (r < 50) {
      worst = "yellow";
    }
  }
  return worst;
}

export function trayIconPath(status: TrayStatus, iconDir: string): string {
  const file =
    status === "green"
      ? "tray-green.png"
      : status === "yellow"
        ? "tray-yellow.png"
        : status === "red"
          ? "tray-red.png"
          : "tray-gray.png";
  return join(iconDir, file);
}

export interface MenuContext {
  readonly status: TrayStatus;
  readonly issueCount: number;
  readonly windowVisible: boolean;
}

export function buildMenuTemplate(
  ctx: MenuContext,
  deps: TrayDeps,
): Electron.MenuItemConstructorOptions[] {
  const issuesLabel =
    ctx.issueCount > 0 ? `Issues (${ctx.issueCount})` : "Issues";
  return [
    {
      label: ctx.windowVisible ? "Hide Dashboard" : "Show Dashboard",
      click: () => toggleWindow(deps),
    },
    {
      label: "Refresh Now",
      click: () => {
        void deps.refresh();
      },
    },
    {
      label: issuesLabel,
      enabled: ctx.issueCount > 0,
      click: () => {
        // Show the dashboard focused on issues; reuse the window toggle
        // path which focuses an existing window or creates one.
        toggleWindow(deps);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => deps.quit(),
    },
  ];
}

function toggleWindow(deps: TrayDeps): void {
  const wins = deps.getWindows();
  if (wins.length === 0) {
    deps.createWindow();
    return;
  }
  const win = wins[0];
  if (win === undefined) return;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

export class TrayManager {
  private readonly deps: TrayDeps;
  private tray: Tray | null = null;
  private currentStatus: TrayStatus = "gray";
  private currentIssueCount = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: TrayDeps) {
    this.deps = deps;
  }

  /** Create the tray and subscribe to poll updates. Idempotent. */
  start(onPoll: (cb: (payload: PushPayload) => void) => () => void): void {
    if (this.tray !== null) return;
    const icon = nativeImage.createFromPath(
      trayIconPath("gray", this.deps.iconDir),
    );
    this.tray = new Tray(icon);
    this.tray.setToolTip("mystatus");
    this.tray.on("click", () => toggleWindow(this.deps));
    this.refreshMenu();
    this.unsubscribe = onPoll((payload) => this.onPoll(payload));
  }

  /** Tear down the tray and unsubscribe. Safe to call when not started. */
  destroy(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.tray !== null) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  private onPoll(payload: PushPayload): void {
    const status = statusForModel(payload.model);
    const issueCount =
      "error" in payload.model ? 0 : payload.model.issues.length;
    if (status === this.currentStatus && issueCount === this.currentIssueCount) {
      return;
    }
    this.currentStatus = status;
    this.currentIssueCount = issueCount;
    if (this.tray !== null) {
      this.tray.setImage(trayIconPath(status, this.deps.iconDir));
      this.refreshMenu();
    }
  }

  private refreshMenu(): void {
    if (this.tray === null) return;
    const wins = this.deps.getWindows();
    const windowVisible = wins.some((w) => w.isVisible());
    const menu = Menu.buildFromTemplate(
      buildMenuTemplate(
        {
          status: this.currentStatus,
          issueCount: this.currentIssueCount,
          windowVisible,
        },
        this.deps,
      ),
    );
    this.tray.setContextMenu(menu);
  }
}

let singleton: TrayManager | null = null;

/**
 * Build the production TrayManager. The icon directory resolves to
 * desktop/build/icons in dev and the packaged resources dir in prod.
 */
export function getTrayManager(
  deps: Pick<TraySingletonDeps, "getWindows" | "createWindow" | "refresh">,
): TrayManager {
  if (singleton === null) {
    const iconDir = app.isPackaged
      ? join(process.resourcesPath, "icons")
      : join(__dirname, "..", "..", "build", "icons");
    singleton = new TrayManager({
      getWindows: deps.getWindows,
      createWindow: deps.createWindow,
      refresh: deps.refresh,
      quit: () => app.quit(),
      iconDir,
    });
  }
  return singleton;
}

export interface TraySingletonDeps {
  readonly getWindows: () => BrowserWindow[];
  readonly createWindow: () => void;
  readonly refresh: () => Promise<void>;
}

export function resetTrayForTest(): void {
  if (singleton !== null) {
    singleton.destroy();
    singleton = null;
  }
}