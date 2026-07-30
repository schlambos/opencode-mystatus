// Tests for the trend-history reader (todo 7).
//
// SAFETY GATE: HOME/USERPROFILE are redirected to a throwaway tmp dir at
// module scope (ipc.test.ts pattern) — the history file resolves through
// homedir() at call time (plugin/mystatus.ts:6673-6678). The reader is also
// asserted to be strictly read-only: it must never create or modify the
// history file (writes belong to the core alone).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect HOME at MODULE scope (same pattern as ipc.test.ts) so no core
// import — however early — can ever resolve the developer's real home.
const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-history-test-"));
process.env["HOME"] = TMP_HOME;
process.env["USERPROFILE"] = TMP_HOME;
mkdirSync(join(TMP_HOME, ".config", "opencode"), { recursive: true });

import { EMPTY_HISTORY, parseHistory } from "./history.js";

describe("parseHistory", () => {
  it("parses a well-formed history file", () => {
    const raw = JSON.stringify({
      version: 1,
      snapshots: [
        { ts: 1000, values: { "Anthropic Account Quota::5-hour limit": 80 } },
        { ts: 2000, values: { "Anthropic Account Quota::5-hour limit": 72, "Ollama Cloud::Session": 99 } },
      ],
    });
    const parsed = parseHistory(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.snapshots).toHaveLength(2);
    expect(parsed.snapshots[0]).toEqual({
      ts: 1000,
      values: { "Anthropic Account Quota::5-hour limit": 80 },
    });
    expect(parsed.snapshots[1]?.values["Ollama Cloud::Session"]).toBe(99);
  });

  it("returns an empty series for malformed JSON instead of throwing", () => {
    expect(parseHistory("{not json!!")).toEqual(EMPTY_HISTORY);
    expect(parseHistory("")).toEqual(EMPTY_HISTORY);
  });

  it("returns an empty series for an unknown shape (version drift)", () => {
    expect(parseHistory(JSON.stringify({ snapshots: "nope" }))).toEqual(EMPTY_HISTORY);
    expect(parseHistory(JSON.stringify([1, 2, 3]))).toEqual(EMPTY_HISTORY);
    expect(parseHistory(JSON.stringify(null))).toEqual(EMPTY_HISTORY);
    expect(parseHistory(JSON.stringify({ entries: [] }))).toEqual(EMPTY_HISTORY);
  });

  it("tolerates a future version number with extra fields", () => {
    const raw = JSON.stringify({
      version: 7,
      format: "delta-encoded",
      snapshots: [{ ts: 5, values: { "P::w": 42 }, extra: true }],
    });
    const parsed = parseHistory(raw);
    expect(parsed.version).toBe(7);
    expect(parsed.snapshots).toEqual([{ ts: 5, values: { "P::w": 42 } }]);
  });

  it("drops malformed snapshots and non-numeric values but keeps the rest", () => {
    const raw = JSON.stringify({
      version: 1,
      snapshots: [
        { ts: 1, values: { a: 10, b: "x", c: Number.NaN } },
        { ts: "later", values: { a: 20 } },
        "garbage",
        { ts: 3, values: { a: 30 } },
        { ts: 4 },
      ],
    });
    const parsed = parseHistory(raw);
    expect(parsed.snapshots).toEqual([
      { ts: 1, values: { a: 10 } },
      { ts: 3, values: { a: 30 } },
    ]);
  });
});

describe("coreApi.readHistory (tmp HOME)", () => {
  const historyPath = join(TMP_HOME, ".config", "opencode", "mystatus-history.json");

  afterAll(() => {
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(historyPath, { force: true });
  });

  it("reads a seeded history file", async () => {
    const seeded = {
      version: 1,
      snapshots: [{ ts: 111, values: { "Google — a@b::Gemini Pro": 97 } }],
    };
    writeFileSync(historyPath, JSON.stringify(seeded));

    const { coreApi } = await import("./core.js");
    expect(coreApi.readHistory()).toEqual(seeded);
  });

  it("returns an empty series when the file does not exist", async () => {
    const { coreApi } = await import("./core.js");
    expect(coreApi.readHistory()).toEqual(EMPTY_HISTORY);
  });

  it("returns an empty series for a corrupt file", async () => {
    writeFileSync(historyPath, "{{{{ definitely not json");
    const { coreApi } = await import("./core.js");
    expect(coreApi.readHistory()).toEqual(EMPTY_HISTORY);
  });

  it("is strictly read-only: never creates or mutates the file", async () => {
    const { coreApi } = await import("./core.js");

    coreApi.readHistory();
    expect(() => statSync(historyPath)).toThrow();

    const seeded = JSON.stringify({ version: 1, snapshots: [{ ts: 9, values: { k: 1 } }] });
    writeFileSync(historyPath, seeded);
    const before = statSync(historyPath).mtimeMs;
    coreApi.readHistory();
    expect(readFileSync(historyPath, "utf-8")).toBe(seeded);
    expect(statSync(historyPath).mtimeMs).toBe(before);
  });
});

vi.mock("./poller.js", () => ({
  getPoller: () => ({ forceRefresh: vi.fn() }),
}));

describe("mystatus:history IPC wiring", () => {
  it("registers the history channel and serves coreApi.readHistory", async () => {
    const readHistory = vi.fn(() => EMPTY_HISTORY);
    vi.doMock("./core.js", () => ({
      coreApi: {
        getViewModel: vi.fn(),
        getJsonExport: vi.fn(),
        getAnsiExport: vi.fn(),
        getConfig: vi.fn(() => ({})),
        patchConfig: vi.fn((patch: unknown) => patch),
        readHistory,
      },
    }));
    vi.resetModules();

    const { CHANNELS } = await import("../shared/ipc.js");
    const { registerIpc } = await import("./ipc.js");
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerIpc({
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    } as unknown as Parameters<typeof registerIpc>[0]);

    const handler = handlers.get(CHANNELS.history);
    expect(handler).toBeDefined();
    expect(await handler?.()).toEqual(EMPTY_HISTORY);
    expect(readHistory).toHaveBeenCalledTimes(1);
    vi.doUnmock("./core.js");
  });
});
