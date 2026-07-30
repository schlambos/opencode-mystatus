// Tests for atomic config IO with concurrent-writer safety.
//
// SAFETY GATE: HOME/USERPROFILE are redirected to a throwaway tmp dir BEFORE
// importing config-io.ts so the module-level CONFIG_DIR (computed from
// homedir()) points at the throwaway location. The plugin's configFile()
// hardcodes ~/.config/opencode and ignores OPENCODE_CONFIG_DIR, so an
// unredirected test would clobber the developer's real mystatus.json.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect HOME/USERPROFILE before any config-io import resolves homedir().
const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-config-io-"));
process.env["HOME"] = TMP_HOME;
process.env["USERPROFILE"] = TMP_HOME;

const {
  configPath,
  readConfigRaw,
  saveConfigSections,
  onExternalChange,
  verifyConfig,
  ConfigVerifyError,
  readConfigStatus,
  saveSettingsSections,
  resetConfigFile,
  ConfigCorruptError,
  ConfigGuardError,
} = await import("./config-io.js");

function configFile(): string {
  return join(TMP_HOME, ".config", "opencode", "mystatus.json");
}

function configDir(): string {
  return join(TMP_HOME, ".config", "opencode");
}

function seedConfig(content: string): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), content, "utf8");
}

beforeEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
});

describe("readConfigRaw JSONC tolerance", () => {
  it("parses a config with // line and /* */ block comments", () => {
    seedConfig(`{
  // line comment
  "sort": "name",
  /* block
     comment */
  "summary": true,
  "providers": {
    "disabled": ["xai"] // trailing comment
  }
}`);
    const cfg = readConfigRaw();
    expect(cfg.sort).toBe("name");
    expect(cfg.summary).toBe(true);
    expect(cfg.providers?.disabled).toEqual(["xai"]);
  });

  it("does not strip // or /* inside string values", () => {
    seedConfig(`{
  "sort": "name // not a comment",
  "antigravityTools": { "baseUrl": "http://x/* y */" }
}`);
    const cfg = readConfigRaw();
    expect(cfg.sort).toBe("name // not a comment");
    expect(cfg.antigravityTools?.baseUrl).toBe("http://x/* y */");
  });

  it("returns {} when the file is missing", () => {
    expect(readConfigRaw()).toEqual({});
  });

  it("returns {} when the file is unparseable", () => {
    seedConfig("{ not json");
    expect(readConfigRaw()).toEqual({});
  });
});

describe("saveConfigSections nested merge", () => {
  it("preserves providers.disabled when writing providers.hidden", async () => {
    seedConfig(
      JSON.stringify({
        providers: { disabled: ["xai"], hidden: ["poe"] },
      }),
    );
    await saveConfigSections({ providers: { hidden: ["longcat"] } });
    const cfg = readConfigRaw();
    expect(cfg.providers?.disabled).toEqual(["xai"]);
    expect(cfg.providers?.hidden).toEqual(["longcat"]);
  });

  it("preserves providers.hidden when writing providers.disabled", async () => {
    seedConfig(
      JSON.stringify({
        providers: { disabled: ["xai"], hidden: ["poe"] },
      }),
    );
    await saveConfigSections({ providers: { disabled: ["ollama"] } });
    const cfg = readConfigRaw();
    expect(cfg.providers?.disabled).toEqual(["ollama"]);
    expect(cfg.providers?.hidden).toEqual(["poe"]);
  });

  it("merges antigravityTools key-wise", async () => {
    seedConfig(
      JSON.stringify({
        antigravityTools: { enabled: true, usageHours: 168, includeUsage: true },
      }),
    );
    await saveConfigSections({ antigravityTools: { usageHours: 24 } });
    const cfg = readConfigRaw();
    expect(cfg.antigravityTools?.enabled).toBe(true);
    expect(cfg.antigravityTools?.usageHours).toBe(24);
    expect(cfg.antigravityTools?.includeUsage).toBe(true);
  });

  it("merges google key-wise", async () => {
    seedConfig(
      JSON.stringify({
        google: { excludeEmails: ["a@x.com"] },
      }),
    );
    await saveConfigSections({ google: { excludeEmails: ["b@x.com"] } });
    const cfg = readConfigRaw();
    expect(cfg.google?.excludeEmails).toEqual(["b@x.com"]);
  });

  it("replaces arrays outright rather than concatenating", async () => {
    seedConfig(
      JSON.stringify({
        providers: { order: ["a", "b"] },
      }),
    );
    await saveConfigSections({ providers: { order: ["c"] } });
    expect(readConfigRaw().providers?.order).toEqual(["c"]);
  });
});

describe("saveConfigSections preserves unknown keys", () => {
  it("keeps width, layout, and an invented futureKey", async () => {
    seedConfig(
      JSON.stringify({
        width: 100,
        layout: "compact",
        sort: "urgency",
        futureKey: "preserve-me",
      }),
    );
    await saveConfigSections({ sort: "name" });
    const cfg = readConfigRaw();
    expect(cfg.width).toBe(100);
    expect(cfg.layout).toBe("compact");
    expect(cfg.sort).toBe("name");
    expect((cfg as Record<string, unknown>).futureKey).toBe("preserve-me");
  });
});

describe("saveConfigSections atomic write", () => {
  it("leaves no .tmp residue after a successful save", async () => {
    await saveConfigSections({ sort: "name" });
    const files = readdirSync(configDir());
    expect(files).toContain("mystatus.json");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("writes the file with mode 0o600 for a new file (skipped on Windows)", async () => {
    await saveConfigSections({ sort: "name" });
    if (process.platform === "win32") {
      console.log("[skip] file mode 0o600 assertion not applicable on win32");
      return;
    }
    const st = statSync(configFile());
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("preserves the existing file mode on overwrite", async () => {
    seedConfig(JSON.stringify({ sort: "urgency" }));
    if (process.platform !== "win32") chmodSync(configFile(), 0o644);
    await saveConfigSections({ sort: "name" });
    if (process.platform === "win32") return;
    const st = statSync(configFile());
    expect(st.mode & 0o777).toBe(0o644);
  });
});

describe("saveConfigSections verify-after-write", () => {
  it("throws ConfigVerifyError when the re-read does not match the expected value", () => {
    seedConfig(JSON.stringify({ sort: "urgency" }));
    expect(() => verifyConfig(configFile(), { sort: "name" })).toThrow(ConfigVerifyError);
  });

  it("does not throw when the re-read matches the expected value", () => {
    seedConfig(JSON.stringify({ sort: "name", summary: true }));
    expect(() => verifyConfig(configFile(), { sort: "name", summary: true })).not.toThrow();
  });

  it("returns the merged config on a successful save", async () => {
    seedConfig(JSON.stringify({ sort: "urgency", summary: true }));
    const merged = await saveConfigSections({ sort: "name" });
    expect(merged.sort).toBe("name");
    expect(merged.summary).toBe(true);
  });

  it("saveConfigSections verifies after write (end-to-end)", async () => {
    seedConfig(JSON.stringify({ sort: "urgency" }));
    const merged = await saveConfigSections({ sort: "name" });
    const onDisk = readConfigRaw();
    expect(onDisk).toEqual(merged);
  });
});

describe("saveConfigSections concurrent serialization", () => {
  it("serializes two concurrent saves with no lost update", async () => {
    seedConfig(
      JSON.stringify({
        providers: { disabled: [], hidden: [] },
      }),
    );
    const [r1, r2] = await Promise.all([
      saveConfigSections({ providers: { hidden: ["a"] } }),
      saveConfigSections({ providers: { disabled: ["b"] } }),
    ]);
    const cfg = readConfigRaw();
    expect(cfg.providers?.hidden).toEqual(["a"]);
    expect(cfg.providers?.disabled).toEqual(["b"]);
    expect(r1.providers?.hidden).toEqual(["a"]);
    expect(r2.providers?.disabled).toEqual(["b"]);
  });

  it("serializes three concurrent saves touching the same nested object", async () => {
    seedConfig(JSON.stringify({ providers: { hidden: [] } }));
    await Promise.all([
      saveConfigSections({ providers: { hidden: ["a"] } }),
      saveConfigSections({ providers: { hidden: ["b"] } }),
      saveConfigSections({ providers: { hidden: ["c"] } }),
    ]);
    expect(readConfigRaw().providers?.hidden).toEqual(["c"]);
  });
});

describe("onExternalChange", () => {
  // fs.watchFile compares stat snapshots; on filesystems with 1s mtime
  // resolution, two writes in the same second look identical and the
  // callback never fires. bumpMtime advances mtime by a fixed amount so the
  // watcher always sees a change regardless of the wall clock.
  function bumpMtime(path: string, secondsAhead: number): void {
    const future = new Date(Date.now() + secondsAhead * 1000);
    const t = future.getTime() / 1000;
    utimesSync(path, t, t);
  }

  it("fires the callback when the config file is rewritten externally", async () => {
    seedConfig(JSON.stringify({ sort: "urgency" }));
    let calls = 0;
    const unsub = onExternalChange(() => {
      calls++;
    });
    try {
      writeFileSync(configFile(), JSON.stringify({ sort: "name" }), "utf8");
      bumpMtime(configFile(), 10);
      // watchFile polls at 1s; wait up to 5s for the event.
      await waitFor(() => expect(calls).toBeGreaterThan(0), 5000);
    } finally {
      unsub();
    }
  });

  it("unsubscribe stops the callback", async () => {
    seedConfig(JSON.stringify({ sort: "urgency" }));
    let calls = 0;
    const unsub = onExternalChange(() => {
      calls++;
    });
    // watchFile fires an initial callback for an existing file; drain it
    // before resetting and unsubscribing.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    calls = 0;
    unsub();
    writeFileSync(configFile(), JSON.stringify({ sort: "name" }), "utf8");
    bumpMtime(configFile(), 10);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(calls).toBe(0);
  });

  it("fires when the file is created (file did not exist at subscribe time)", async () => {
    let calls = 0;
    const unsub = onExternalChange(() => {
      calls++;
    });
    try {
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(configFile(), JSON.stringify({ sort: "name" }), "utf8");
      bumpMtime(configFile(), 10);
      // watchFile polls at 1s; allow up to 5s for the create detection.
      await waitFor(() => expect(calls).toBeGreaterThan(0), 5000);
    } finally {
      unsub();
    }
  });
});

describe("saveConfigSections failure: read-only file", () => {
  it("propagates a clear error, leaves the original unchanged, and leaves no .tmp residue", async () => {
    seedConfig(JSON.stringify({ sort: "urgency" }));
    if (process.platform !== "win32") {
      chmodSync(configDir(), 0o555);
    }
    const original = readFileSync(configFile(), "utf8");
    await expect(saveConfigSections({ sort: "name" })).rejects.toThrow();
    expect(readFileSync(configFile(), "utf8")).toBe(original);
    if (process.platform !== "win32") {
      const files = readdirSync(configDir());
      expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
      chmodSync(configDir(), 0o755);
    }
  });
});

describe("configPath", () => {
  it("resolves under the redirected HOME", () => {
    expect(configPath()).toBe(join(TMP_HOME, ".config", "opencode", "mystatus.json"));
  });
});

describe("readConfigStatus", () => {
  it("reports ok with the parsed config", () => {
    seedConfig(JSON.stringify({ sort: "name" }));
    const status = readConfigStatus();
    expect(status.status).toBe("ok");
    if (status.status === "ok") expect(status.config.sort).toBe("name");
    expect(status.path).toBe(configFile());
  });

  it("reports missing when the file does not exist", () => {
    expect(readConfigStatus()).toMatchObject({ status: "missing", path: configFile() });
  });

  it("reports corrupt with the parse error for invalid JSON", () => {
    seedConfig("{ not json");
    const status = readConfigStatus();
    expect(status.status).toBe("corrupt");
    if (status.status === "corrupt") expect(status.error.length).toBeGreaterThan(0);
  });
});

describe("saveSettingsSections policy", () => {
  it("refuses to overwrite a corrupt file and leaves the bytes untouched", async () => {
    seedConfig("{ not json");
    await expect(saveSettingsSections({ sort: "name" })).rejects.toThrow(ConfigCorruptError);
    expect(readFileSync(configFile(), "utf8")).toBe("{ not json");
  });

  it("refuses a providers payload missing hidden when hidden exists on disk", async () => {
    seedConfig(JSON.stringify({ providers: { hidden: ["poe"], disabled: ["xai"] } }));
    await expect(
      saveSettingsSections({ providers: { disabled: ["xai", "ollama"], order: [] } }),
    ).rejects.toThrow(ConfigGuardError);
    expect(readConfigRaw().providers?.disabled).toEqual(["xai"]);
  });

  it("accepts a fully-formed providers payload and writes the exact disabled array", async () => {
    seedConfig(JSON.stringify({ providers: { hidden: ["poe"], disabled: ["xai"] } }));
    const merged = await saveSettingsSections({
      providers: { disabled: ["xai", "ollama"], order: [], hidden: ["poe"] },
    });
    expect(merged.providers?.disabled).toEqual(["xai", "ollama"]);
    expect(merged.providers?.hidden).toEqual(["poe"]);
    expect(readConfigRaw().providers?.disabled).toEqual(["xai", "ollama"]);
  });

  it("creates the file on a missing config", async () => {
    await expect(saveSettingsSections({ sort: "name" })).resolves.toMatchObject({ sort: "name" });
  });
});

describe("resetConfigFile", () => {
  it("replaces a corrupt file with an empty config", async () => {
    seedConfig("{ not json");
    await expect(resetConfigFile()).resolves.toEqual({});
    expect(readConfigRaw()).toEqual({});
    expect(readConfigStatus().status).toBe("ok");
  });

  it("refuses to reset a file that parses cleanly", async () => {
    seedConfig(JSON.stringify({ sort: "name" }));
    await expect(resetConfigFile()).rejects.toThrow(ConfigGuardError);
    expect(readConfigRaw().sort).toBe("name");
  });
});

async function waitFor(assertion: () => void, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assertion();
}