// Tests for registerIpc wiring, focused on the desktop prefs channels
// (mystatus:prefs:get / mystatus:prefs:patch). HOME is redirected to a tmp
// dir BEFORE prefs.ts resolves homedir() so the real ~/.config/opencode is
// never touched. core.js and poller.js are mocked so the plugin core and
// Electron are never loaded here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../shared/ipc.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
}));

const { registerIpc } = await import("./ipc.js");
const { shell } = await import("electron");

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

  function configFile(): string {
    return join(configDir(), "mystatus.json");
  }

  function seedConfig(content: string): void {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(configFile(), content, "utf8");
  }

  function registeredHandlers(): Map<string, Handler> {
    const ipc = makeFakeIpc();
    registerIpc(ipc as unknown as Parameters<typeof registerIpc>[0]);
    return ipc.handlers;
  }

  describe("config:inspect / config:save / config:reset (todo 14)", () => {
    it("config:inspect reports ok with the parsed config and path", async () => {
      seedConfig(JSON.stringify({ sort: "name" }));
      const handlers = registeredHandlers();

      const status = (await handlers.get(CHANNELS.configInspect)?.()) as {
        status: string;
        path: string;
        config?: { sort?: string };
      };

      expect(status.status).toBe("ok");
      expect(status.path).toBe(configFile());
      expect(status.config?.sort).toBe("name");
    });

    it("config:inspect reports corrupt for a hand-corrupted file", async () => {
      seedConfig("{ not json");
      const handlers = registeredHandlers();

      const status = (await handlers.get(CHANNELS.configInspect)?.()) as { status: string };
      expect(status.status).toBe("corrupt");
    });

    it("config:save writes sections atomically and returns the merged config", async () => {
      seedConfig(JSON.stringify({ providers: { hidden: ["poe"], disabled: ["xai"] } }));
      const handlers = registeredHandlers();

      const merged = (await handlers.get(CHANNELS.configSave)?.(undefined, {
        providers: { disabled: ["xai", "ollama"], order: [], hidden: ["poe"] },
      })) as { providers?: { disabled?: string[]; hidden?: string[] } };

      expect(merged.providers?.disabled).toEqual(["xai", "ollama"]);
      const onDisk = JSON.parse(readFileSync(configFile(), "utf8")) as {
        providers?: { disabled?: string[] };
      };
      expect(onDisk.providers?.disabled).toEqual(["xai", "ollama"]);
    });

    it("config:save rejects a providers payload missing hidden when hidden exists on disk", async () => {
      seedConfig(JSON.stringify({ providers: { hidden: ["poe"] } }));
      const handlers = registeredHandlers();

      await expect(
        handlers.get(CHANNELS.configSave)?.(undefined, { providers: { disabled: ["xai"] } }),
      ).rejects.toThrow(/hidden/);
    });

    it("config:save refuses to overwrite a corrupt file", async () => {
      seedConfig("{ not json");
      const handlers = registeredHandlers();

      await expect(
        handlers.get(CHANNELS.configSave)?.(undefined, { sort: "name" }),
      ).rejects.toThrow(/not parseable/);
      expect(readFileSync(configFile(), "utf8")).toBe("{ not json");
    });

    it("config:reset recovers a corrupt file but refuses a valid one", async () => {
      seedConfig("{ not json");
      const handlers = registeredHandlers();
      await expect(handlers.get(CHANNELS.configReset)?.()).resolves.toEqual({});

      seedConfig(JSON.stringify({ sort: "name" }));
      await expect(handlers.get(CHANNELS.configReset)?.()).rejects.toThrow(/parses cleanly/);
    });
  });

  describe("reveal (todo 14)", () => {
    it("shows mystatus.json in the file manager for target config", async () => {
      const handlers = registeredHandlers();
      const shown = vi.mocked(shell.showItemInFolder);
      shown.mockClear();

      await handlers.get(CHANNELS.reveal)?.(undefined, "config");

      expect(shown).toHaveBeenCalledWith(configFile());
    });

    it("shows mystatus-desktop.json for target prefs", async () => {
      const handlers = registeredHandlers();
      const shown = vi.mocked(shell.showItemInFolder);
      shown.mockClear();

      await handlers.get(CHANNELS.reveal)?.(undefined, "prefs");

      expect(shown).toHaveBeenCalledWith(join(configDir(), "mystatus-desktop.json"));
    });

    it("rejects unknown targets instead of revealing an arbitrary path", async () => {
      const handlers = registeredHandlers();
      const shown = vi.mocked(shell.showItemInFolder);
      shown.mockClear();

      const handler = handlers.get(CHANNELS.reveal);
      expect(() => handler?.(undefined, "../../etc")).toThrow(/unknown reveal target/);
      expect(shown).not.toHaveBeenCalled();
    });
  });
});
