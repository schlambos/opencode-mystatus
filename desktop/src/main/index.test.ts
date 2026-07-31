import { describe, it, expect, vi } from "vitest";
import { CHANNELS } from "../shared/ipc.js";

// Mock the `electron` module so we can assert IPC registration without booting
// the real Electron runtime. Only `ipcMain.handle` is exercised here.
vi.mock("electron", () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn);
      },
    },
    __handlers: handlers,
  };
});

import { registerShellIpc } from "./index.js";

describe("registerShellIpc", () => {
  it("registers the ping channel and the handler returns 'pong'", async () => {
    const { ipcMain, __handlers } = await import("electron") as unknown as {
      ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => void };
      __handlers: Map<string, (...a: unknown[]) => unknown>;
    };

    // The mock implements only `handle`; registerShellIpc uses nothing else.
    registerShellIpc(ipcMain as unknown as Parameters<typeof registerShellIpc>[0]);

    const handler = __handlers.get(CHANNELS.ping);
    expect(handler).toBeDefined();
    expect(await handler?.()).toBe("pong");
  });

  it("uses the shared channel name constant", () => {
    expect(CHANNELS.ping).toBe("mystatus:ping");
    expect(CHANNELS.push).toBe("mystatus:push");
  });
});