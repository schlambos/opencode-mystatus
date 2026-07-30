import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHANNELS } from "../shared/ipc.js";
import { registerIpc } from "./ipc.js";
import { getPoller } from "./poller.js";
import { getTrayManager } from "./tray.js";
import { createUpdater } from "./updater.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register shell IPC handlers. Extracted so a unit test can mock `ipcMain`
// and assert the channel is wired without booting Electron.
export function registerShellIpc(ipc: typeof ipcMain): void {
  ipc.handle(CHANNELS.ping, () => "pong");
}

function createWindow(): BrowserWindow {
  const isDev = !app.isPackaged;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: "mystatus",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"] ?? "http://localhost:5173");
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

function focusExistingWindow(): void {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    const [win] = wins;
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

function bootstrap(): void {
  // Single-instance lock — must be acquired before any window is created.
  // On failure (another instance owns the lock) we quit immediately; the
  // already-running instance focuses its window via the second-instance event.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    focusExistingWindow();
  });

  const poller = getPoller();

  app.on("window-all-closed", () => {
    // On darwin the app stays alive in the tray when the tray exists; on
    // other platforms a tray-only app is unusual, so we still quit. The
    // tray keeps the poller alive via setTrayAlive(true).
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.whenReady().then(() => {
    registerShellIpc(ipcMain);
    registerIpc(ipcMain);
    poller.start();

    // Auto-updater: gated off by default (see updater.ts). Only activates
    // in a packaged build with MYSTATUS_ENABLE_UPDATES=1. No-op in dev and
    // in unsigned packaged builds.
    const updater = createUpdater();
    updater.start();

    // Tray: keeps the app alive on darwin and drives the poller even with
    // no windows open. The tray subscribes to poll updates to refresh its
    // icon/menu on each completed fetch.
    const tray = getTrayManager({
      getWindows: () => BrowserWindow.getAllWindows(),
      createWindow,
      refresh: () => poller.forceRefresh(),
    });
    tray.start((cb) => poller.onPoll(cb));
    poller.setTrayAlive(true);

    createWindow();
  });

  app.on("before-quit", () => {
    poller.stop();
  });
}

// Only boot the real app when running outside the test harness. Vitest sets
// VITEST; importing this module under test would otherwise touch Electron
// APIs that the test mock does not provide.
if (!process.env["VITEST"]) {
  bootstrap();
}