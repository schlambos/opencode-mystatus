import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type Bridge } from "../shared/ipc.js";

// Narrow preload bridge. Exposes only invoke-only methods plus a single
// push subscription (onViewModel). The full ipcRenderer object is NEVER
// leaked to the renderer — only the explicit methods below cross the
// context bridge, and each invoke/send is bound to a known channel.
const api: Bridge = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping),
  getViewModel: (args) => ipcRenderer.invoke(CHANNELS.viewmodel, args ?? {}),
  getExport: (req) => ipcRenderer.invoke(CHANNELS.export, req),
  getConfig: () => ipcRenderer.invoke(CHANNELS.configGet),
  patchConfig: (patch) => ipcRenderer.invoke(CHANNELS.configPatch, patch ?? {}),
  getPrefs: () => ipcRenderer.invoke(CHANNELS.prefsGet),
  patchPrefs: (patch) => ipcRenderer.invoke(CHANNELS.prefsPatch, patch ?? {}),
  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
  getHistory: () => ipcRenderer.invoke(CHANNELS.history),
  capture: (spec) => ipcRenderer.invoke(CHANNELS.capture, spec),
  getAuthStatus: () => ipcRenderer.invoke(CHANNELS.authStatus),
  pasteCopilot: (payload) => ipcRenderer.invoke(CHANNELS.pasteCopilot, payload),
  pastePoe: (payload) => ipcRenderer.invoke(CHANNELS.pastePoe, payload),
  clearCredential: (name) => ipcRenderer.invoke(CHANNELS.clearCredential, name),
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url),
  inspectConfig: () => ipcRenderer.invoke(CHANNELS.configInspect),
  saveConfigSections: (sections) => ipcRenderer.invoke(CHANNELS.configSave, sections ?? {}),
  resetConfig: () => ipcRenderer.invoke(CHANNELS.configReset),
  revealPath: (target) => ipcRenderer.invoke(CHANNELS.reveal, target),
  onViewModel: (cb) => {
    const handler = (_event: unknown, payload: unknown): void => {
      cb(payload as Parameters<typeof cb>[0]);
    };
    ipcRenderer.on(CHANNELS.push, handler);
    return () => {
      ipcRenderer.off(CHANNELS.push, handler);
    };
  },
};

contextBridge.exposeInMainWorld("mystatus", api);

export type MystatusBridge = typeof api;