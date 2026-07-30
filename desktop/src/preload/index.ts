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
  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
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