// IPC registration for the typed core bridge.
//
// Each request channel is wired to a coreApi method. The handlers are
// extracted into registerIpc(ipc) so a unit test can mock `ipcMain` and
// assert every channel is wired without booting Electron. The push channel
// is main→renderer only (webContents.send) and has no handler here.

import type { IpcMain } from "electron";
import { shell } from "electron";
import {
  CHANNELS,
  type CaptureRequest,
  type ConfigPatch,
  type CopilotPastePayload,
  type CredentialFileName,
  type PoePastePayload,
  type PrefsPatch,
  type RevealTarget,
} from "../shared/ipc.js";
import { coreApi } from "./core.js";
import { getPoller } from "./poller.js";
import { loadPrefs, patchPrefs, prefsPath } from "./prefs.js";
import { handleCapture } from "./capture.js";
import {
  configPath,
  readConfigStatus,
  resetConfigFile,
  saveSettingsSections,
} from "./config-io.js";
import {
  clearCredentialFile,
  getAuthStatus,
  writeCopilotPAT,
  writePoeApiKey,
} from "./paste-creds.js";
import {
  deleteCredentialFile,
  testProvider,
  writeCredentialFile,
} from "./cred-files.js";
import { getAntigravityEnvStatus } from "./antigravity-settings.js";

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
  ipc.handle(CHANNELS.history, () => coreApi.readHistory());
  ipc.handle(CHANNELS.capture, (_event, spec: CaptureRequest) => handleCapture(spec ?? ({} as CaptureRequest)));
  ipc.handle(CHANNELS.authStatus, () => getAuthStatus());
  ipc.handle(CHANNELS.pasteCopilot, (_event, payload: CopilotPastePayload) =>
    writeCopilotPAT(payload ?? ({} as CopilotPastePayload)),
  );
  ipc.handle(CHANNELS.pastePoe, (_event, payload: PoePastePayload) =>
    writePoeApiKey(payload ?? ({} as PoePastePayload)),
  );
  ipc.handle(CHANNELS.clearCredential, (_event, name: CredentialFileName) =>
    clearCredentialFile(name ?? ""),
  );
  ipc.handle(CHANNELS.writeCredential, (_event, name: CredentialFileName, data: Record<string, unknown>) =>
    writeCredentialFile(name ?? ("" as CredentialFileName), data ?? {}),
  );
  ipc.handle(CHANNELS.testProvider, (_event, providerId: string) =>
    testProvider(providerId ?? ""),
  );
  ipc.handle(CHANNELS.openExternal, (_event, url: string) => shell.openExternal(url));
  ipc.handle(CHANNELS.configInspect, () => readConfigStatus());
  ipc.handle(CHANNELS.configSave, (_event, sections: ConfigPatch) =>
    saveSettingsSections((sections ?? {}) as ConfigPatch),
  );
  ipc.handle(CHANNELS.configReset, () => resetConfigFile());
  ipc.handle(CHANNELS.reveal, (_event, target: RevealTarget) => {
    const path =
      target === "config" ? configPath() : target === "prefs" ? prefsPath() : null;
    if (path === null) throw new Error(`unknown reveal target: ${String(target)}`);
    shell.showItemInFolder(path);
  });
  ipc.handle(CHANNELS.envAntigravity, () => getAntigravityEnvStatus());
}
