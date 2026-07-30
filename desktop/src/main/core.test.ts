// Tests for the typed core bridge facade.
//
// SAFETY GATE: every test redirects HOME/USERPROFILE to a throwaway tmp dir
// BEFORE importing the core. The plugin's configFile() resolves
// ~/.config/opencode at call time (plugin/mystatus.ts:6673-6678), so an
// unredirected test would overwrite the developer's real mystatus.json,
// cache, and history. We set the env vars in beforeAll and import the core
// lazily inside the tests so the redirect is guaranteed to precede any
// module evaluation that could touch the filesystem.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeAll(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "mystatus-core-test-"));
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // The core's configFile() writes to ~/.config/opencode/ and saveConfig
  // silently swallows ENOENT (plugin/mystatus.ts:6745-6747). Pre-create the
  // dir so patchConfig round-trips actually persist.
  mkdirSync(join(tmpHome, ".config", "opencode"), { recursive: true });
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("coreApi.getViewModel", () => {
  it("returns a MyStatusViewModel or {error}, never throws", async () => {
    const { coreApi } = await import("./core.js");
    const result = await coreApi.getViewModel({});
    // With no credentials in the tmp HOME, the core returns either a model
    // (if it finds zero providers worth reporting) or an {error} string.
    // Both shapes are valid; a throw is not.
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    if ("error" in result) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    } else {
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.providers)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.alerts)).toBe(true);
      expect(typeof result.threshold).toBe("number");
      expect(result.health).toBeDefined();
    }
  });
});

describe("coreApi.patchConfig round-trip", () => {
  it("writes a patch and reads it back via getConfig", async () => {
    const { coreApi } = await import("./core.js");
    const before = coreApi.getConfig();
    const patched = coreApi.patchConfig({ sort: "name" });
    expect(patched.sort).toBe("name");
    const after = coreApi.getConfig();
    expect(after.sort).toBe("name");
    // patchConfig is a shallow merge — unrelated keys survive.
    if (before.summary !== undefined) expect(after.summary).toBe(before.summary);
  });

  it("preserves a previously written key across a second patch", async () => {
    const { coreApi } = await import("./core.js");
    coreApi.patchConfig({ sort: "name" });
    coreApi.patchConfig({ summary: false });
    const cfg = coreApi.getConfig();
    expect(cfg.sort).toBe("name");
    expect(cfg.summary).toBe(false);
  });
});

describe("coreApi.getJsonExport / getAnsiExport", () => {
  it("getJsonExport returns format:'json' and a string", async () => {
    const { coreApi } = await import("./core.js");
    const out = await coreApi.getJsonExport({});
    expect(out.format).toBe("json");
    expect(typeof out.text).toBe("string");
  });

  it("getAnsiExport returns format:'ansi' and a string", async () => {
    const { coreApi } = await import("./core.js");
    const out = await coreApi.getAnsiExport({});
    expect(out.format).toBe("ansi");
    expect(typeof out.text).toBe("string");
  });
});