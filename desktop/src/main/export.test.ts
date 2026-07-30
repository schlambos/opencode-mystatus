// Tests for export-to-file (todo 15) and launch-at-login (todo 15).
//
// SAFETY GATE: writes go to a tmp dir created per test; HOME is NOT redirected
// because saveExport writes to whatever path dialog.showSaveDialog returns,
// which the test controls. The core is mocked so no real provider query runs.
//
// No Electron GUI, no Playwright, no bin/mystatus. dialog.showSaveDialog is
// mocked via the ExportDeps seam; coreApi is mocked via vi.mock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportDeps } from "./export.js";

vi.mock("./core.js", () => ({
  coreApi: {
    getJsonExport: vi.fn(),
    getAnsiExport: vi.fn(),
  },
}));

const { saveExport } = await import("./export.js");
const { coreApi } = await import("./core.js");
const { setLoginItem } = await import("./login-item.js");

// ---------------------------------------------------------------------------
// Fake BrowserWindow — only the showSaveDialog method is exercised.
// ---------------------------------------------------------------------------

interface FakeDialogResult {
  canceled: boolean;
  filePath?: string;
}

function makeFakeWindow(dialogResult: FakeDialogResult): {
  win: unknown;
  showSaveDialog: ExportDeps["showSaveDialog"];
} {
  const showSaveDialog = vi.fn(async () => dialogResult);
  return {
    win: { showSaveDialog },
    showSaveDialog: showSaveDialog as unknown as ExportDeps["showSaveDialog"],
  };
}

function makeDeps(dialogResult: FakeDialogResult): ExportDeps {
  return makeFakeWindow(dialogResult);
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mystatus-export-"));
  vi.mocked(coreApi.getJsonExport).mockReset();
  vi.mocked(coreApi.getAnsiExport).mockReset();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveExport — JSON", () => {
  it("writes the JSON payload to the chosen path and returns ok with the path", async () => {
    const payload = JSON.stringify({ cells: [], health: { queried: 0, rendered: 0, stale: 0, failed: 0, unconfigured: 0 } });
    vi.mocked(coreApi.getJsonExport).mockResolvedValue({ format: "json", text: payload });
    const filePath = join(tmpDir, "out.json");
    const deps = makeDeps({ canceled: false, filePath });

    const result = await saveExport({} as never, { format: "json" }, deps);

    expect(result).toEqual({ ok: true, path: filePath });
    expect(readFileSync(filePath, "utf8")).toBe(payload);
    expect(coreApi.getJsonExport).toHaveBeenCalledWith({});
  });

  it("forwards args (threshold) to the core", async () => {
    vi.mocked(coreApi.getJsonExport).mockResolvedValue({ format: "json", text: "{}" });
    const filePath = join(tmpDir, "args.json");
    const deps = makeDeps({ canceled: false, filePath });

    await saveExport({} as never, { format: "json", args: { threshold: 30 } }, deps);

    expect(coreApi.getJsonExport).toHaveBeenCalledWith({ threshold: 30 });
  });

  it("refuses to write when the JSON export does not parse (core error string)", async () => {
    vi.mocked(coreApi.getJsonExport).mockResolvedValue({ format: "json", text: "no providers configured" });
    const filePath = join(tmpDir, "err.json");
    const deps = makeDeps({ canceled: false, filePath });

    const result = await saveExport({} as never, { format: "json" }, deps);

    expect(result.ok).toBe(false);
    if (!result.ok && !("cancelled" in result)) {
      expect(result.error).toContain("no providers configured");
    }
    expect(existsSync(filePath)).toBe(false);
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
  });
});

describe("saveExport — ANSI", () => {
  it("writes the ANSI payload verbatim (ESC sequences preserved) to the .txt path", async () => {
    const ansi = "\x1b[32mgreen\x1b[0m \x1b[31mred\x1b[0m";
    vi.mocked(coreApi.getAnsiExport).mockResolvedValue({ format: "ansi", text: ansi });
    const filePath = join(tmpDir, "out.txt");
    const deps = makeDeps({ canceled: false, filePath });

    const result = await saveExport({} as never, { format: "ansi" }, deps);

    expect(result).toEqual({ ok: true, path: filePath });
    expect(readFileSync(filePath, "utf8")).toBe(ansi);
    expect(coreApi.getAnsiExport).toHaveBeenCalledWith({});
  });
});

describe("saveExport — cancelled", () => {
  it("returns cancelled:true when the user dismisses the save dialog and writes no file", async () => {
    vi.mocked(coreApi.getJsonExport).mockResolvedValue({ format: "json", text: "{}" });
    const filePath = join(tmpDir, "cancelled.json");
    const deps = makeDeps({ canceled: true });

    const result = await saveExport({} as never, { format: "json" }, deps);

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(existsSync(filePath)).toBe(false);
  });
});

describe("saveExport — write failure", () => {
  it("returns error when the file write throws", async () => {
    vi.mocked(coreApi.getJsonExport).mockResolvedValue({ format: "json", text: "{}" });
    // A path that cannot be written (under a non-existent dir without mkdir
    // permission) — use a path inside a file treated as a dir.
    const filePath = join(tmpDir, "i-am-a-file", "out.json");
    // Pre-create a FILE at the parent path so mkdir fails.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpDir, "i-am-a-file"), "blocker", "utf8");
    const deps = makeDeps({ canceled: false, filePath });

    const result = await saveExport({} as never, { format: "json" }, deps);

    expect(result.ok).toBe(false);
    if (!result.ok && !("cancelled" in result)) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe("saveExport — core throws", () => {
  it("returns error when coreApi rejects (defensive — coreApi never throws in practice)", async () => {
    vi.mocked(coreApi.getJsonExport).mockRejectedValue(new Error("core boom"));
    const filePath = join(tmpDir, "throw.json");
    const deps = makeDeps({ canceled: false, filePath });

    const result = await saveExport({} as never, { format: "json" }, deps);

    expect(result.ok).toBe(false);
    if (!result.ok && !("cancelled" in result)) {
      expect(result.error).toContain("core boom");
    }
    expect(existsSync(filePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// launch-item (todo 15)
// ---------------------------------------------------------------------------

describe("setLoginItem", () => {
  it("calls setLoginItemSettings on darwin and reports supported", () => {
    const setLoginItemSettings = vi.fn();
    const result = setLoginItem(
      { openAtLogin: true },
      { platform: "darwin", setLoginItemSettings },
    );
    expect(result).toEqual({ ok: true, supported: true, openAtLogin: true });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it("calls setLoginItemSettings on win32 and reports supported", () => {
    const setLoginItemSettings = vi.fn();
    const result = setLoginItem(
      { openAtLogin: false },
      { platform: "win32", setLoginItemSettings },
    );
    expect(result).toEqual({ ok: true, supported: true, openAtLogin: false });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it("is a documented no-op on Linux that still reports ok with supported:false", () => {
    const setLoginItemSettings = vi.fn();
    const result = setLoginItem(
      { openAtLogin: true },
      { platform: "linux", setLoginItemSettings },
    );
    expect(result).toEqual({ ok: true, supported: false, openAtLogin: true });
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("reports ok even when the OS call throws (best-effort, prefs stay in sync)", () => {
    const setLoginItemSettings = vi.fn(() => {
      throw new Error("OS refused");
    });
    const result = setLoginItem(
      { openAtLogin: true },
      { platform: "darwin", setLoginItemSettings },
    );
    expect(result).toEqual({ ok: true, supported: true, openAtLogin: true });
  });

  it("treats a missing openAtLogin as false", () => {
    const setLoginItemSettings = vi.fn();
    const result = setLoginItem(
      {} as never,
      { platform: "darwin", setLoginItemSettings },
    );
    expect(result.openAtLogin).toBe(false);
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });
});