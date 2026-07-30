// Tests for the desktop prefs store. HOME is redirected to a tmp dir BEFORE
// importing prefs.ts so the module-level CONFIG_DIR (computed from homedir())
// points at the throwaway location. The plugin's configFile() hardcodes
// ~/.config/opencode and ignores OPENCODE_CONFIG_DIR, so an unredirected test
// would clobber the developer's real config.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect HOME/USERPROFILE before any prefs import resolves homedir().
const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-prefs-"));
process.env["HOME"] = TMP_HOME;
process.env["USERPROFILE"] = TMP_HOME;

const { DEFAULT_PREFS, loadPrefs, savePrefs, patchPrefs, prefsPath } = await import("./prefs.js");

function prefsFile(): string {
  return join(TMP_HOME, ".config", "opencode", "mystatus-desktop.json");
}

function configDir(): string {
  return join(TMP_HOME, ".config", "opencode");
}

beforeEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
});

describe("prefs defaults", () => {
  it("returns defaults when the file is absent", () => {
    const p = loadPrefs();
    expect(p).toEqual(DEFAULT_PREFS);
  });

  it("defaults match the plan: threshold 25, notifications true, cooldown 60", () => {
    expect(DEFAULT_PREFS.threshold).toBe(25);
    expect(DEFAULT_PREFS.notifications).toBe(true);
    expect(DEFAULT_PREFS.notifyCooldownMin).toBe(60);
    expect(DEFAULT_PREFS.launchAtLogin).toBe(false);
  });
});

describe("prefs round-trip", () => {
  it("save then load returns the same values", () => {
    const next = {
      ...DEFAULT_PREFS,
      threshold: 10,
      trendMode: "full" as const,
      notifications: false,
      notifyCooldownMin: 30,
      lastTab: "weekly",
      windowBounds: { x: 100, y: 200, width: 1200, height: 800 },
      launchAtLogin: true,
    };
    savePrefs(next);
    expect(loadPrefs()).toEqual(next);
  });

  it("patch merges over the existing file", () => {
    savePrefs({ ...DEFAULT_PREFS, threshold: 15 });
    const merged = patchPrefs({ notifications: false });
    expect(merged.threshold).toBe(15);
    expect(merged.notifications).toBe(false);
    expect(loadPrefs().notifications).toBe(false);
  });

  it("patch over a missing file applies defaults first", () => {
    const merged = patchPrefs({ threshold: 40 });
    expect(merged.threshold).toBe(40);
    expect(merged.notifications).toBe(DEFAULT_PREFS.notifications);
  });
});

describe("prefs corrupt-file fallback", () => {
  it("returns defaults when the file is not valid JSON", () => {
    const dir = configDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(prefsFile(), "{ not json", "utf8");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("does not throw and does not overwrite the corrupt file on load", () => {
    const dir = configDir();
    mkdirSync(dir, { recursive: true });
    const corrupt = "{ broken";
    writeFileSync(prefsFile(), corrupt, "utf8");
    loadPrefs();
    expect(readFileSync(prefsFile(), "utf8")).toBe(corrupt);
  });

  it("coerces unknown/invalid fields back to defaults", () => {
    const dir = configDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      prefsFile(),
      JSON.stringify({
        threshold: "high",
        trendMode: "banana",
        notifications: "yes",
        notifyCooldownMin: null,
        lastTab: 42,
        windowBounds: "big",
        launchAtLogin: 1,
        unknownExtra: "ignored",
      }),
      "utf8",
    );
    const p = loadPrefs();
    expect(p.threshold).toBe(DEFAULT_PREFS.threshold);
    expect(p.trendMode).toBeUndefined();
    expect(p.notifications).toBe(DEFAULT_PREFS.notifications);
    expect(p.notifyCooldownMin).toBe(DEFAULT_PREFS.notifyCooldownMin);
    expect(p.lastTab).toBeUndefined();
    expect(p.windowBounds).toBeUndefined();
    expect(p.launchAtLogin).toBe(DEFAULT_PREFS.launchAtLogin);
  });
});

describe("prefs atomic write", () => {
  it("leaves no .tmp residue after a successful save", () => {
    savePrefs({ ...DEFAULT_PREFS, threshold: 30 });
    const files = readdirSync(configDir());
    expect(files).toContain("mystatus-desktop.json");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("creates the config dir with mode 0o700 when missing", () => {
    savePrefs({ ...DEFAULT_PREFS });
    expect(existsSync(configDir())).toBe(true);
    if (process.platform !== "win32") {
      const st = statSync(configDir());
      // mask to permission bits
      expect(st.mode & 0o777).toBe(0o700);
    }
  });

  it("writes the prefs file with mode 0o600 (skipped on Windows with a reason)", () => {
    savePrefs({ ...DEFAULT_PREFS });
    if (process.platform === "win32") {
      // Windows has no Unix permission bits; chmod is a no-op. Skip with reason.
      console.log("[skip] file mode 0o600 assertion not applicable on win32");
      return;
    }
    const st = statSync(prefsFile());
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe("prefsPath", () => {
  it("resolves under the redirected HOME", () => {
    expect(prefsPath()).toBe(join(TMP_HOME, ".config", "opencode", "mystatus-desktop.json"));
  });
});