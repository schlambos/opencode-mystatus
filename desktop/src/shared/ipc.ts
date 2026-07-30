// Shared IPC types. The full contract lands in todo 2; this file exists so
// main/preload/renderer agree on the bridge shape and channel names from day one.

export const CHANNELS = {
  ping: "mystatus:ping",
  push: "mystatus:push",
} as const;

export interface Bridge {
  ping: () => Promise<unknown>;
  onPush: (cb: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    mystatus: Bridge;
  }
}

export {};