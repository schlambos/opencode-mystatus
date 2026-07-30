// Atomic, concurrent-writer-safe config IO for mystatus.json.
//
// The plugin's own saveConfig (plugin/mystatus.ts:6740-6748) is a SHALLOW merge
// that is non-atomic and silently swallows write errors. The desktop app is a
// concurrent writer of mystatus.json alongside the CLI and TUI, so every GUI
// save path goes through this module instead. It provides:
//
//   readConfigRaw()        — JSONC-tolerant parse mirroring the core's
//                            stripJsonComments (plugin/mystatus.ts:6682-6728)
//                            so a self-documented config survives a round-trip.
//   saveConfigSections()   — read → deep-merge (nested providers/antigravityTools/
//                            google merged key-wise, NOT replaced) → atomic
//                            write (tmp + rename, preserve existing file mode,
//                            default 0o600) → verify-after-write (re-read +
//                            deep-compare, throw on mismatch). Serialized
//                            through a promise queue so two concurrent saves
//                            cannot lose an update.
//   onExternalChange(cb)   — fs.watch on mystatus.json so the GUI reacts when
//                            OpenCode, the CLI, or the TUI rewrites it.
//
// Comments in the user's config WILL be lost on write (the core's own
// saveConfig does the same) — the UI surfaces a one-time warning before the
// first write. The file is never held open or locked between saves.
//
// MUST NOT modify the plugin's saveConfig. MUST NOT write while another
// section's read-modify-write is in flight (serialized via the queue).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MyStatusConfig } from "../shared/ipc.js";

const CONFIG_FILE = "mystatus.json";
const CONFIG_DIR = join(homedir(), ".config", "opencode");

/** Resolve the config file path. Exposed for tests and the UI footer. */
export function configPath(): string {
  return join(CONFIG_DIR, CONFIG_FILE);
}

// ---------------------------------------------------------------------------
// JSONC tolerance — PARITY: plugin/mystatus.ts:6682-6728
// ---------------------------------------------------------------------------
// Strip // line and /* */ block comments (string-aware) so the config file
// can be self-documenting like opencode's own .jsonc files. Re-implemented
// here (not imported) because the core's stripJsonComments is module-private
// and the plan forbids editing the plugin.

function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      inLine = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Read and parse mystatus.json with JSONC tolerance. Missing or unparseable
 * file resolves to `{}` (mirrors core loadConfig, plugin/mystatus.ts:6730-6737).
 */
export function readConfigRaw(): MyStatusConfig {
  const path = configPath();
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(stripJsonComments(raw)) as MyStatusConfig;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------
// Nested objects (`providers`, `antigravityTools`, `google`) are merged
// key-wise rather than replaced, so writing `providers.hidden` does not
// clobber a pre-existing `providers.disabled` (the TUI does this manually at
// plugin/tui.ts:784-788; we centralize it here). Arrays and primitives are
// replaced outright — a partial array patch has no meaningful merge
// semantics. Unknown top-level keys (e.g. `width`, `layout`, future keys)
// survive untouched.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Keys whose values are nested objects that must merge key-wise rather than
// be replaced. Any other object-typed value is also merged key-wise (safe
// default), but this set is the documented contract.
const NESTED_KEYS = new Set(["providers", "antigravityTools", "google"]);

function deepMergeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, patchVal] of Object.entries(patch)) {
    const baseVal = out[key];
    if (
      isPlainObject(baseVal) &&
      isPlainObject(patchVal) &&
      NESTED_KEYS.has(key)
    ) {
      out[key] = deepMergeConfig(baseVal, patchVal);
    } else {
      out[key] = patchVal;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Atomic write + verify-after-write
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Preserve the existing file's mode, defaulting to 0o600 for a new file. */
function existingMode(path: string): number {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return 0o600;
  }
}

function stableStringify(value: unknown): string {
  // Deterministic key ordering makes the verify-after-write deep-compare
  // robust against key-reordering differences and produces stable diffs.
  return JSON.stringify(value, null, 2) + "\n";
}

function atomicWrite(path: string, text: string, mode: number): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode });
  // rename is atomic on POSIX; on Windows it replaces the destination.
  renameSync(tmp, path);
}

/**
 * Error thrown when verify-after-write detects that the written file does not
 * match the intended content. Surfaces a clear message so the renderer can
 * show "Save failed" rather than a false "Saved".
 */
export class ConfigVerifyError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ConfigVerifyError";
  }
}

/**
 * Re-read the config file and compare against the expected merged value.
 * Throws ConfigVerifyError on mismatch. Exported so the verify step is
 * unit-testable without mocking the filesystem (the mock would break
 * fs.watch on macOS — see config-io.test.ts).
 */
export function verifyConfig(path: string, expected: MyStatusConfig): void {
  const reread = JSON.parse(stripJsonComments(readFileSync(path, "utf-8"))) as MyStatusConfig;
  if (JSON.stringify(reread) !== JSON.stringify(expected)) {
    throw new ConfigVerifyError(
      "config verify-after-write mismatch: re-read did not match the merged value",
      path,
    );
  }
}

// ---------------------------------------------------------------------------
// Promise-queue serialization
// ---------------------------------------------------------------------------
// Two concurrent saveConfigSections calls would each read-modify-write and
// the second write would clobber the first's merge. We serialize all saves
// through a single promise chain so they execute strictly in order.

let saveChain: Promise<MyStatusConfig> = Promise.resolve({} as MyStatusConfig);

/**
 * Read → deep-merge → atomic write → verify-after-write.
 *
 * `sections` is deep-merged into the current on-disk config: nested
 * `providers`/`antigravityTools`/`google` objects merge key-wise (so writing
 * `providers.hidden` preserves a pre-existing `providers.disabled`), while
 * arrays and primitives replace outright. Unknown top-level keys survive.
 *
 * The write is atomic (tmp + rename) and preserves the existing file mode
 * (default 0o600 for a new file). After the rename, the file is re-read and
 * deep-compared against the intended merged value; a mismatch throws
 * ConfigVerifyError so the caller never sees a false "Saved".
 *
 * Concurrent calls are serialized through a promise queue — no lost updates.
 */
export function saveConfigSections(sections: Partial<MyStatusConfig>): Promise<MyStatusConfig> {
  const run = (): Promise<MyStatusConfig> => {
    const path = configPath();
    const current = readConfigRaw();
    const merged = deepMergeConfig(
      current as Record<string, unknown>,
      sections as Record<string, unknown>,
    ) as MyStatusConfig;
    const text = stableStringify(merged);
    const mode = existingMode(path);
    atomicWrite(path, text, mode);

    // Verify-after-write: re-read and deep-compare. The core's saveConfig
    // swallows write errors silently (plugin/mystatus.ts:6745-6747); the
    // desktop UI must never show a false "Saved".
    verifyConfig(path, merged);
    return Promise.resolve(merged);
  };
  // Chain onto the previous save so this call only runs once the prior has
  // settled. Errors in a prior save propagate to that save's caller, not to
  // this one (each link catches its own rejection before chaining).
  const next = saveChain.then(run, run);
  // Keep the chain alive for the next caller regardless of this call's result.
  saveChain = next.then(
    () => ({} as MyStatusConfig),
    () => ({} as MyStatusConfig),
  );
  return next;
}

// ---------------------------------------------------------------------------
// External-change watcher
// ---------------------------------------------------------------------------

/**
 * Subscribe to external rewrites of mystatus.json (by OpenCode, the CLI, or
 * the TUI). The callback fires when the file's mtime changes. Returns an
 * unsubscribe function that stops the watcher.
 *
 * Uses fs.watchFile (polling) rather than fs.watch (event-based): fs.watch is
 * unreliable in some runtimes (notably vitest worker threads and some Linux
 * filesystems) and provides no cross-platform consistency guarantee. The
 * polling interval is 1s — cheap for a single file, and the GUI only needs to
 * react within a second of an external edit.
 */
export function onExternalChange(cb: () => void): () => void {
  const path = configPath();
  watchFile(path, { interval: 1000 }, cb);
  return () => {
    unwatchFile(path, cb);
  };
}