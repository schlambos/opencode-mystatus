// Guided paste for Copilot PAT + Poe API key (todo 12).
//
// These two providers do NOT use browser cookie capture. The user pastes a
// fine-grained PAT (Copilot) or an API key (Poe) into a masked field; this
// module validates the input and writes the EXACT plugin JSON schema to
// ~/.config/opencode/ atomically (tmp + rename, mode 0o600, dir 0o700).
//
// auth:status reports which provider ids have a readable auth.json entry OR
// a credential file present — provider-id presence ONLY, never token values.
// The plugin reads auth.json via searchPaths("auth.json", "data")
// (plugin/mystatus.ts:442-471) and credential files via findReadable(<name>,
// "config") (plugin/mystatus.ts:2024, 3039). We mirror that read order here
// WITHOUT importing the core (the helpers are module-private and the plan
// forbids editing the plugin), so auth:status stays accurate to what the core
// will actually find.
//
// Deep links to the provider token-management pages go through
// shell.openExternal via a dedicated IPC so the renderer never imports the
// Electron shell directly.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CREDENTIAL_FILE_NAMES,
  isCredentialFileName,
  type AuthStatus,
  type ClearResult,
  type CopilotPastePayload,
  type CopilotTier,
  type PasteResult,
  type PoePastePayload,
} from "../shared/ipc.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const DATA_DIR_LEGACY = join(homedir(), ".local", "share", "opencode");

const COPILOT_FILE = "copilot-quota-token.json";
const POE_FILE = "poe-api-key.json";

// Provider ids the plugin looks up in auth.json (plugin/mystatus.ts:192-205).
// Only these are reported in auth:status — anything else in the file is
// ignored so we never surface a key the core does not consume.
const AUTH_JSON_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "github-copilot",
  "opencode-go",
  "poe",
  "zai-coding-plan",
  "xai-oauth",
  "xai",
  "kimi-for-coding",
  "minimax-coding-plan",
  "nano-gpt",
  "qwen-token-plan",
] as const;

// Credential files the plugin reads via findReadable(<name>, "config").
// The canonical list lives in shared/ipc.ts (CREDENTIAL_FILE_NAMES) so the
// IPC allowlist, the writers, and this auth:status report can never drift.

const COPILOT_TIERS: readonly CopilotTier[] = ["pro", "pro+", "max"];

// ---------------------------------------------------------------------------
// Path resolution — mirrors the core's candidateDirs/findReadable precedence
// (plugin/mystatus.ts:394-427) for the READ side. Writes always go to the
// legacy ~/.config/opencode/ dir (the core's configFile write target,
// plugin/mystatus.ts:6673-6678) — todo 13 will add profile-aware write
// resolution; todo 12 keeps it simple and matches the plugin's own write dir.
// ---------------------------------------------------------------------------

function candidateDataDirs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string | undefined): void => {
    if (!p) return;
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  if (process.env["XDG_DATA_HOME"]) add(join(process.env["XDG_DATA_HOME"], "opencode"));
  // opencode-multi profile dirs (plugin/mystatus.ts:369-392).
  const profilesRoot = join(homedir(), "Library", "Application Support", "opencode-multi", "profiles");
  try {
    for (const name of readdirSafe(profilesRoot)) {
      add(join(profilesRoot, name));
    }
  } catch {
    // profiles root absent — fine
  }
  add(DATA_DIR_LEGACY);
  return out;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "opencode")
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function candidateConfigDirs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string | undefined): void => {
    if (!p) return;
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  if (process.env["OPENCODE_CONFIG_DIR"]) add(process.env["OPENCODE_CONFIG_DIR"]);
  const profilesRoot = join(homedir(), "Library", "Application Support", "opencode-multi", "profiles");
  try {
    for (const name of readdirSafe(profilesRoot)) {
      add(join(profilesRoot, name));
    }
  } catch {
    // profiles root absent — fine
  }
  add(CONFIG_DIR);
  return out;
}

function findReadableConfig(name: string): string | null {
  for (const dir of candidateConfigDirs()) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function findReadableData(name: string): string | null {
  for (const dir of candidateDataDirs()) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Resolve the write path for a credential file: legacy ~/.config/opencode/. */
export function resolveCredentialWritePath(name: string): string {
  return join(CONFIG_DIR, name);
}

// ---------------------------------------------------------------------------
// Atomic write + verify-after-write
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function existingMode(path: string): number {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return 0o600;
  }
}

function atomicWrite(path: string, text: string): void {
  ensureDir(dirname(path));
  const mode = existingMode(path);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, path);
}

function verifyWrite(path: string, expected: unknown): void {
  const reread = JSON.parse(readFileSync(path, "utf8"));
  if (JSON.stringify(reread) !== JSON.stringify(expected)) {
    throw new Error(`verify-after-write mismatch for ${path}`);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateCopilot(payload: CopilotPastePayload): string | null {
  if (!isNonEmptyString(payload.token)) return "token is required";
  if (!isNonEmptyString(payload.username)) return "username is required";
  if (!COPILOT_TIERS.includes(payload.tier)) {
    return `tier must be one of ${COPILOT_TIERS.join(", ")}`;
  }
  return null;
}

function validatePoe(payload: PoePastePayload): string | null {
  if (!isNonEmptyString(payload.apiKey)) return "apiKey is required";
  return null;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function writeCopilotPAT(payload: CopilotPastePayload): PasteResult {
  const err = validateCopilot(payload);
  if (err !== null) return { ok: false, error: err };
  const data = { token: payload.token, username: payload.username, tier: payload.tier };
  const path = resolveCredentialWritePath(COPILOT_FILE);
  try {
    atomicWrite(path, JSON.stringify(data, null, 2) + "\n");
    verifyWrite(path, data);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function writePoeApiKey(payload: PoePastePayload): PasteResult {
  const err = validatePoe(payload);
  if (err !== null) return { ok: false, error: err };
  const data = { apiKey: payload.apiKey };
  const path = resolveCredentialWritePath(POE_FILE);
  try {
    atomicWrite(path, JSON.stringify(data, null, 2) + "\n");
    verifyWrite(path, data);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Delete a credential file by name. Two guards, both mandatory: the runtime
 * allowlist (only known credential file names) and a containment check on
 * the resolved path (must stay directly inside CONFIG_DIR). Without these a
 * renderer-supplied name like "../../.ssh/id_ed25519" would escape via the
 * bare join() and turn this into an arbitrary file delete.
 */
export function clearCredentialFile(name: string): ClearResult {
  if (!isCredentialFileName(name)) {
    return { ok: false, error: `refusing to clear unknown credential file: ${name}` };
  }
  const path = resolveCredentialWritePath(name);
  const resolved = resolve(path);
  if (dirname(resolved) !== resolve(CONFIG_DIR)) {
    return { ok: false, error: `refusing to clear outside ${CONFIG_DIR}: ${name}` };
  }
  if (!existsSync(resolved)) return { ok: true, path: resolved };
  try {
    rmSync(resolved);
    return { ok: true, path: resolved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// auth:status — provider-id presence ONLY, never token values
// ---------------------------------------------------------------------------

export function getAuthStatus(): AuthStatus {
  const authJson: string[] = [];
  const authPath = findReadableData("auth.json");
  if (authPath !== null) {
    try {
      const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
      for (const id of AUTH_JSON_PROVIDER_IDS) {
        if (raw[id] !== undefined) authJson.push(id);
      }
    } catch {
      // malformed auth.json — report nothing rather than guessing
    }
  }

  const credentialFiles: string[] = [];
  for (const name of CREDENTIAL_FILE_NAMES) {
    if (findReadableConfig(name) !== null) credentialFiles.push(name);
  }

  return { authJson, credentialFiles };
}

// ---------------------------------------------------------------------------
// Deep-link URLs (opened via shell.openExternal in the IPC layer)
// ---------------------------------------------------------------------------

export const COPILOT_PAT_URL = "https://github.com/settings/tokens?type=beta";
export const POE_API_KEY_URL = "https://poe.com/api_key";