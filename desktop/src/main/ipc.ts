// IPC registration for the typed core bridge.
//
// Each request channel is wired to a coreApi method. The handlers are
// extracted into registerIpc(ipc) so a unit test can mock `ipcMain` and
// assert every channel is wired without booting Electron. The push channel
// is main→renderer only (webContents.send) and has no handler here.

import type { IpcMain } from "electron";
import { CHANNELS, type PrefsPatch } from "../shared/ipc.js";
import { coreApi } from "./core.js";
import { getPoller } from "./poller.js";
import { loadPrefs, patchPrefs } from "./prefs.js";

export function registerIpc(ipc: IpcMain): void {
  ipc.handle(CHANNELS.viewmodel, (_event, args) => coreApi.getViewModel(args ?? {}));
  ipc.handle(CHANNELS.export, (_event, req) => {
    const format = req?.format === "json" ? "json" : "ansi";
    const args = req?.args ?? {};
    return format === "json"
      ? coreApi.getJsonExport(args)
      : coreApi.getAnsiExport(args);
  });
  ipc.handle(CHANNELS.configGet, () => coreApi.getConfig());
  ipc.handle(CHANNELS.configPatch, (_event, patch) => coreApi.patchConfig(patch ?? {}));
  ipc.handle(CHANNELS.prefsGet, () => loadPrefs());
  ipc.handle(CHANNELS.prefsPatch, (_event, patch) => patchPrefs((patch ?? {}) as PrefsPatch));
  ipc.handle(CHANNELS.refresh, () => getPoller().forceRefresh());
}