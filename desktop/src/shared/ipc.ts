// Shared IPC types. The full contract lands in todo 2; this file exists so
// main/preload/renderer agree on the bridge shape from day one.

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