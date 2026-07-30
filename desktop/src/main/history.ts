// Read-only access to the core's trend history file.
//
// The core writes ~/.config/opencode/mystatus-history.json (configFile,
// plugin/mystatus.ts:6673-6678) as `{version, snapshots: [{ts, values}]}`
// (plugin/mystatus.ts:6940-6943). The file is core-internal and may change
// shape, so parsing is version-tolerant: anything unrecognized degrades to
// an empty series instead of throwing. This module NEVER writes the file.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HistoryResponse, HistorySnapshot } from "../shared/ipc.js";

export const EMPTY_HISTORY: HistoryResponse = { version: 1, snapshots: [] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// PARITY: plugin/mystatus.ts:6945-6953 (loadHistory tolerance), extended to
// validate per-snapshot shape so a future file version cannot poison series.
export function parseHistory(raw: string): HistoryResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_HISTORY;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["snapshots"])) return EMPTY_HISTORY;

  const version = typeof parsed["version"] === "number" && Number.isFinite(parsed["version"])
    ? parsed["version"]
    : 1;

  const snapshots: HistorySnapshot[] = [];
  for (const entry of parsed["snapshots"]) {
    if (!isRecord(entry)) continue;
    const ts = entry["ts"];
    const rawValues = entry["values"];
    if (typeof ts !== "number" || !Number.isFinite(ts) || !isRecord(rawValues)) continue;
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
    }
    snapshots.push({ ts, values });
  }
  return { version, snapshots };
}

export function historyFile(): string {
  // PARITY: plugin/mystatus.ts:6673-6678 — history lives in the legacy global
  // dir, not per-profile.
  return join(homedir(), ".config", "opencode", "mystatus-history.json");
}

export function readHistory(): HistoryResponse {
  try {
    return parseHistory(readFileSync(historyFile(), "utf-8"));
  } catch {
    return EMPTY_HISTORY;
  }
}
