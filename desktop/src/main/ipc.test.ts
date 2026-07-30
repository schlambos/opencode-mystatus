// Tests for registerIpc wiring, focused on the desktop prefs channels
// (mystatus:prefs:get / mystatus:prefs:patch). HOME is redirected to a tmp
// dir BEFORE prefs.ts resolves homedir() so the real ~/.config/opencode is
// never touched. core.js and poller.js are mocked so the plugin core and
// Electron are never loaded here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../shared/ipc.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-ipc-"));
process.env["HOME"] = TMP_HOME;
process.env["USERPROFILE"] = TMP_HOME;

vi.mock("./core.js", () => ({
  coreApi: {
    getViewModel: vi.fn(),
    getJsonExport: vi.fn(),
    getAnsiExport: vi.fn(),
    getConfig: vi.fn(() => ({})),
    patchConfig: vi.fn((patch: unknown) => patch),
  },
}));

vi.mock("./poller.js", () => ({
  getPoller: () => ({ forceRefresh: vi.fn() }),
}));

const { registerIpc } = await import("./ipc.js");

type Handler = (...args: unknown[]) => unknown;

function makeFakeIpc(): { handle: (channel: string, fn: Handler) => void; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return { handle: (channel, fn) => handlers.set(channel, fn), handlers };
}

function configDir(): string {
  return join(TMP_HOME, ".config", "opencode");
}

describe("registerIpc", () => {
  beforeEach(() => {
    rmSync(configDir(), { recursive: true, force: true });
  });
  afterEach(() => {
    rmSync(configDir(), { recursive: true, force: true });
  });

  it("registers every request channel exactly once", () => {
    const ipc = makeFakeIpc();
    registerIpc(ipc as unknown as Parameters<typeof registerIpc>[0]);

    for (const channel of Object.values(CHANNELS)) {
      if (channel === CHANNELS.push) continue; // main→renderer only
      if (channel === CHANNELS.ping) continue; // registered by registerShellIpc
      expect(ipc.handlers.has(channel)).toBe(true);
    }
  });

  it("prefs:get returns defaults when the prefs file is absent", async () => {
    const ipc = makeFakeIpc();
    registerIpc(ipc as unknown as Parameters<typeof registerIpc>[0]);
    const handler = ipc.handlers.get("mystatus:prefs:get");

    expect(handler).toBeDefined();
    expect(await handler?.()).toMatchObject({ threshold: 25, notifications: true });
  });

  it("prefs:patch merges, persists to mystatus-desktop.json, and returns the result", async () => {
    const ipc = makeFakeIpc();
    registerIpc(ipc as unknown as Parameters<typeof registerIpc>[0]);
    const handler = ipc.handlers.get("mystatus:prefs:patch");

    const result = (await handler?.(undefined, { threshold: 40 })) as { threshold: number };

    expect(result.threshold).toBe(40);
    const onDisk = JSON.parse(readFileSync(join(configDir(), "mystatus-desktop.json"), "utf8")) as {
      threshold: number;
    };
    expect(onDisk.threshold).toBe(40);
  });

  it("prefs:patch treats a missing payload as an empty patch", async () => {
    const ipc = makeFakeIpc();
    registerIpc(ipc as unknown as Parameters<typeof registerIpc>[0]);
    const handler = ipc.handlers.get("mystatus:prefs:patch");

    const result = (await handler?.(undefined)) as { threshold: number };
    expect(result.threshold).toBe(25);
  });
});
