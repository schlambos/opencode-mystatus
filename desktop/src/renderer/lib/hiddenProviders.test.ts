import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigPatch, MyStatusConfig } from "../../shared/ipc";

// Parity anchors: plugin/tui.ts:781-788 (persistHidden shallow-merge dance),
// plugin/mystatus.ts:6740-6748 (saveConfig shallow merge — the hazard),
// plugin/mystatus.ts:6805-6818 (disabled ≠ hidden).
//
// The fake bridge's patchConfig replicates the core's SHALLOW top-level merge so
// the tests prove setProviderHidden sends a fully-formed `providers` object.

interface FakeBridge {
  getConfig: () => Promise<MyStatusConfig>;
  patchConfig: (patch: ConfigPatch) => Promise<MyStatusConfig>;
}

describe("setProviderHidden — shallow-merge safety + race", () => {
  let config: MyStatusConfig;
  let patchCalls: ConfigPatch[];
  let bridge: FakeBridge;

  beforeEach(() => {
    config = {
      sort: "name",
      providers: { disabled: ["xai"], order: ["openai", "anthropic"], hidden: [] },
    };
    patchCalls = [];
    bridge = {
      getConfig: () => Promise.resolve(config),
      patchConfig: (patch) => {
        patchCalls.push(patch);
        config = { ...config, ...patch };
        return Promise.resolve(config);
      },
    };
    vi.stubGlobal("window", { mystatus: bridge });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function freshModule() {
    return import("./hiddenProviders");
  }

  it("preserves pre-existing disabled and order when writing hidden", async () => {
    const { setProviderHidden } = await freshModule();
    await setProviderHidden("longcat", true);

    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]).toEqual({
      providers: { disabled: ["xai"], order: ["openai", "anthropic"], hidden: ["longcat"] },
    });
    expect(config.providers?.disabled).toEqual(["xai"]);
    expect(config.providers?.order).toEqual(["openai", "anthropic"]);
    expect(config.providers?.hidden).toEqual(["longcat"]);
    expect(config.sort).toBe("name");
  });

  it("is safe when no providers section exists yet", async () => {
    config = { sort: "urgency" };
    const { setProviderHidden } = await freshModule();
    await setProviderHidden("poe", true);

    expect(config.providers?.hidden).toEqual(["poe"]);
    expect(config.sort).toBe("urgency");
  });

  it("unhiding removes only the named provider, case-insensitively", async () => {
    config.providers = { disabled: [], hidden: ["Ollama Cloud", "poe"] };
    const { setProviderHidden } = await freshModule();
    await setProviderHidden("ollama cloud", false);

    expect(config.providers?.hidden).toEqual(["poe"]);
  });

  it("two rapid hide/unhide clicks settle last-write-wins and consistent", async () => {
    const { setProviderHidden } = await freshModule();
    // Fired back-to-back without awaiting — the queue must serialize them so the
    // unhide (second) reads the hide (first) and wins.
    const first = setProviderHidden("Ollama Cloud", true);
    const second = setProviderHidden("Ollama Cloud", false);
    await Promise.all([first, second]);

    expect(config.providers?.hidden).toEqual([]); // unhide won
    expect(config.providers?.disabled).toEqual(["xai"]); // never touched
    expect(config.providers?.order).toEqual(["openai", "anthropic"]);
  });

  it("keeps the queue alive when patchConfig rejects (best-effort, like core)", async () => {
    const { setProviderHidden } = await freshModule();
    bridge.patchConfig = () => Promise.reject(new Error("disk full"));
    await expect(setProviderHidden("a", true)).resolves.toBeUndefined();

    bridge.patchConfig = (patch) => {
      patchCalls.push(patch);
      config = { ...config, ...patch };
      return Promise.resolve(config);
    };
    await setProviderHidden("b", true);
    expect(config.providers?.hidden).toEqual(["b"]);
    expect(config.providers?.disabled).toEqual(["xai"]);
  });

  it("demonstrates the hazard a bare patch would cause (guard)", () => {
    // WITHOUT the {...cfg.providers} spread, the core shallow merge wipes siblings.
    bridge.patchConfig({ providers: { hidden: ["longcat"] } });
    expect(config.providers?.disabled).toBeUndefined();
    expect(config.providers?.order).toBeUndefined();
  });
});
