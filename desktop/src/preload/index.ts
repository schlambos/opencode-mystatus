import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../shared/ipc.js";

// Minimal shell bridge. The full typed IPC contract lands in todo 2.
// Expose only invoke + a push subscription; never leak ipcRenderer wholesale.
const api = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping),
  onPush: (cb: (payload: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on(CHANNELS.push, handler);
    return () => ipcRenderer.off(CHANNELS.push, handler);
  },
} as const;

contextBridge.exposeInMainWorld("mystatus", api);

export type MystatusBridge = typeof api;