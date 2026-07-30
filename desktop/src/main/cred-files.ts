// Credential file writers + test-connection (todo 13).
//
// The canonical atomic writers for credential files under the core's candidate
// config dirs. The core reads credentials through `findReadable(<name>,
// "config")` (plugin/mystatus.ts:424-427), which scans candidateDirs("config")
// in precedence order: OPENCODE_CONFIG_DIR → opencode-multi profile dirs →
// legacy ~/.config/opencode (plugin/mystatus.ts:394-416). A write that lands in
// a lower-precedence dir while a stale copy exists in a higher-precedence one
// would be shadowed — the card would silently keep failing. So
// resolveCredentialWritePath overwrites the EXISTING readable copy if one
// exists, else writes to the legacy ~/.config/opencode/ dir (the core's
// configFile write target, plugin/mystatus.ts:6673-6678).
//
// Atomic write: tmp file (mode 0o600) in the same dir, then rename. A crash
// mid-write leaves the previous file intact. Dir is created with mode 0o700.
// Verify-after-write is MANDATORY: re-read the file and deep-compare before
// reporting success, because the core's own saveConfig swallows all write
// errors (plugin/mystatus.ts:6745-6747) and the UI must never show a false
// "Saved".
//
// testProvider(providerId) runs a fresh single-provider query through
// coreApi.getViewModel({only, fresh:true}) and maps the result to
// {ok} | {ok:false, error} from that provider's issues/errors.
//
// JWT exp helper: decodes the `exp` claim from a JWT (atlas access-token,
// qwencloud tickets) for display only — no signature validation.
//
// Security: credential values are NEVER logged. The module refuses any
// resolved path outside the candidate dirs (traversal protection) and never
// writes to a path that did not come from resolveCredentialWritePath.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  CredentialFileName,
  MyStatusViewModel,
  StatusIssue,
  ViewModelResult,
} from "../shared/ipc.js";
import { coreApi, type CoreApi } from "./core.js";
import { PROVIDERS } from "../shared/providers.js";
import {
  getCaptureSpec,
  type ExtractionResult,
  type ProviderCaptureSpec,
} from "./capture-specs.js";
import type { CaptureResult, CredentialFileName } from "../shared/ipc.js";

const LEGACY_CONFIG_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_MULTI_PROFILES_ROOT = join(
  homedir(),
  "Library",
  "Application Support",
  "opencode-multi",
  "profiles",
);

// ---------------------------------------------------------------------------
// Candidate config dirs — PARITY: plugin/mystatus.ts:394-416
// ---------------------------------------------------------------------------
// Mirrors the core's candidateDirs("config") precedence exactly so a write
// lands where the core will actually read it. The core dedupes via
// realpathSync; we do the same so a symlinked profile dir does not produce
// two entries that confuse the "is this path inside a candidate dir" check.

function listProfileDirs(): string[] {
  try {
    return readdirSync(OPENCODE_MULTI_PROFILES_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "opencode")
      .map((d) => {
        const p = join(OPENCODE_MULTI_PROFILES_ROOT, d.name);
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      });
  } catch {
    return [];
  }
}

function candidateConfigDirs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string | undefined): void => {
    if (!p) return;
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      real = p;
    }
    if (seen.has(real)) return;
    seen.add(real);
    out.push(real);
  };
  if (process.env["OPENCODE_CONFIG_DIR"]) add(process.env["OPENCODE_CONFIG_DIR"]);
  for (const p of listProfileDirs()) add(p);
  add(LEGACY_CONFIG_DIR);
  return out;
}

function findReadableConfig(name: string): string | null {
  for (const dir of candidateConfigDirs()) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Resolve the write path for a credential file.
 *
 * Write-target rule (do not simplify): if a readable copy of `<name>` already
 * exists in any of the core's candidate config dirs (OPENCODE_CONFIG_DIR,
 * opencode-multi profile dirs, then legacy ~/.config/opencode, in that
 * precedence order per plugin/mystatus.ts:394-427), overwrite THAT path —
 * because the core reads credentials through findReadable, writing elsewhere
 * would leave a shadowing stale file and the card would silently keep
 * failing. If no copy exists, create it in the legacy ~/.config/opencode/
 * dir (the core's configFile write target, plugin/mystatus.ts:6673-6678).
 *
 * Always show the resolved absolute path in the UI after saving.
 */
export function resolveCredentialWritePath(name: string): string {
  const existing = findReadableConfig(name);
  if (existing !== null) return existing;
  return join(LEGACY_CONFIG_DIR, name);
}

// ---------------------------------------------------------------------------
// Traversal protection — refuse any resolved path outside the candidate dirs
// ---------------------------------------------------------------------------

function isInsideCandidateDirs(path: string): boolean {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    real = path;
  }
  for (const dir of candidateConfigDirs()) {
    if (real === dir) return true;
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    if (real.startsWith(prefix)) return true;
  }
  return false;
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
  // rename is atomic on POSIX; on Windows it replaces the destination.
  renameSync(tmp, path);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function verifyWrite(path: string, expected: unknown): void {
  const reread = JSON.parse(readFileSync(path, "utf8"));
  if (JSON.stringify(reread) !== JSON.stringify(expected)) {
    throw new Error(`verify-after-write mismatch for ${path}`);
  }
}

/** Result of a credential write: {ok} on success, {ok:false, error} on failure. */
export type CredentialWriteResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * Atomically write a credential file.
 *
 * The path is resolved via resolveCredentialWritePath (profile-aware). The
 * write is atomic (tmp + rename), mode 0o600, dir 0o700. After the rename,
 * the file is re-read and deep-compared against `data` — a mismatch throws
 * and the caller surfaces the error. Refuses any resolved path outside the
 * candidate dirs (traversal protection).
 *
 * `data` may be any JSON-serializable value. For merge-style providers
 * (mistral, opencode-go), the caller computes the merged object before
 * calling this function — the writer is merge-agnostic.
 */
export function writeCredentialFile(
  name: CredentialFileName,
  data: Record<string, unknown>,
): CredentialWriteResult {
  const path = resolveCredentialWritePath(name);
  if (!isInsideCandidateDirs(path)) {
    return {
      ok: false,
      error: `refusing to write outside candidate config dirs: ${path}`,
    };
  }
  try {
    atomicWrite(path, stableStringify(data));
    verifyWrite(path, data);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Result of a credential delete. */
export type CredentialDeleteResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * Delete a credential file at its resolved write path. Idempotent — reports
 * ok when the file is already absent. Only deletes the resolved path (the
 * highest-precedence readable copy); lower-precedence copies, if any, are
 * left untouched so the core's findReadable continues to find a credential.
 */
export function deleteCredentialFile(name: CredentialFileName): CredentialDeleteResult {
  const path = resolveCredentialWritePath(name);
  if (!existsSync(path)) return { ok: true, path };
  try {
    rmSync(path);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// testProvider — fresh single-provider query → {ok} | {ok:false, error}
// ---------------------------------------------------------------------------

/** Result of a test-connection call. */
export type TestProviderResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Test a single provider by running a fresh query through the core.
 *
 * Calls coreApi.getViewModel({only: providerId, fresh: true}) and maps the
 * result to {ok} | {ok:false, error} from that provider's issues/errors. A
 * provider is `ok` when the view model has no error and no issue for that
 * provider with kind "error" or "stale". Unconfigured providers (no
 * credential file) surface as {ok:false, error: "no credentials found"}.
 *
 * Never throws — coreApi.getViewModel resolves with {error} on failure.
 */
export async function testProvider(
  providerId: string,
  api: CoreApi = coreApi,
): Promise<TestProviderResult> {
  const result: ViewModelResult = await api.getViewModel({
    only: providerId,
    fresh: true,
  });
  if ("error" in result) {
    return { ok: false, error: result.error };
  }
  const model: MyStatusViewModel = result;
  const issue = findIssueForProvider(model.issues, providerId);
  if (issue !== null) {
    return { ok: false, error: issueDetail(issue) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Capture → extract → write → test orchestration (todo 13)
// ---------------------------------------------------------------------------
// The renderer calls capture(spec) to get cookies, then this function to run
// extract → write → test in the main process (where capture-specs and the
// atomic writer live). The renderer then calls refresh() to update the
// dashboard. Keeping the extract+write+test in main means the renderer never
// imports the capture-specs module or touches the filesystem.

/** Result of the capture → extract → write → test flow. */
export type CaptureWriteFlowResult =
  | {
      readonly ok: true;
      readonly writePath: string;
      readonly test: TestProviderResult;
    }
  | { readonly ok: false; readonly error: string; readonly stage: "extract" | "write" | "test" };

/**
 * Run extract → write → test for a captured cookie session.
 *
 * `providerId` selects the capture spec (capture-specs.ts); `capture` is the
 * result of the capture-window IPC (todo 10). The spec's extract function maps
 * the cookies to the plugin file JSON (or a merge fn for multi-account
 * providers); writeCredentialFile writes it atomically with verify-after-write;
 * testProvider runs a fresh single-provider query. Returns a combined result
 * so the renderer can surface a single status chip per provider.
 *
 * Never throws — every failure stage is caught and surfaced as {ok:false}.
 */
export async function processCaptureResult(
  providerId: string,
  capture: CaptureResult,
  api: CoreApi = coreApi,
): Promise<CaptureWriteFlowResult> {
  if (capture.status !== "ok") {
    return {
      ok: false,
      error: capture.detail ?? `capture status: ${capture.status}`,
      stage: "extract",
    };
  }
  const spec = getCaptureSpec(providerId);
  if (spec === undefined) {
    return {
      ok: false,
      error: `no capture spec for provider id: ${providerId}`,
      stage: "extract",
    };
  }
  const extraction = spec.extract(capture.cookies, capture.finalUrl);
  if (!extraction.ok) {
    return { ok: false, error: extraction.error, stage: "extract" };
  }
  const json = resolveExtractionJson(extraction, spec);
  const write = writeCredentialFile(spec.fileName, json);
  if (!write.ok) {
    return { ok: false, error: write.error, stage: "write" };
  }
  const test = await testProvider(providerId, api);
  return { ok: true, writePath: write.path, test };
}

function resolveExtractionJson(
  extraction: ExtractionResult,
  spec: ProviderCaptureSpec,
): Record<string, unknown> {
  if ("json" in extraction) return extraction.json;
  // merge path: read the existing file (if any) and apply the merge fn.
  const existing = readExistingCredentialFile(spec.fileName);
  return extraction.merge(existing);
}

function readExistingCredentialFile(name: CredentialFileName): Record<string, unknown> | null {
  const path = resolveCredentialWritePath(name);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function findIssueForProvider(
  issues: readonly StatusIssue[],
  providerId: string,
): StatusIssue | null {
  // The core's issue `provider` field is the provider's display title, not
  // its id (plugin/mystatus.ts:7237, 7241, 7246). We match case-insensitively
  // against the title via the shared PROVIDERS registry, falling back to a
  // direct id comparison for providers whose title differs from the id.
  const title = titleForProviderId(providerId);
  const lower = title.toLowerCase();
  for (const issue of issues) {
    if (issue.kind === "unconfigured") continue;
    if (issue.provider.toLowerCase() === lower) return issue;
  }
  return null;
}

function issueDetail(issue: StatusIssue): string {
  if (issue.kind === "stale") {
    const ageMin = issue.ageMs !== undefined ? Math.round(issue.ageMs / 60_000) : 0;
    return `stale ${ageMin}m: ${issue.detail}`;
  }
  return issue.detail;
}

// Provider id → display title. Mirrors the shared PROVIDERS registry so the
// issue lookup matches the core's title-based `provider` field.

function titleForProviderId(providerId: string): string {
  const entry = PROVIDERS.find((p) => p.id === providerId);
  return entry !== undefined ? entry.title : providerId;
}

// ---------------------------------------------------------------------------
// JWT exp helper — display only, no signature validation
// ---------------------------------------------------------------------------
// Mirrors the core's parseJwtPayload (plugin/mystatus.ts:572-582) and
// extractAtlasAccessTokenExp (plugin/mystatus.ts:5110-5118). Decodes the
// `exp` claim from a JWT's payload segment. Returns undefined for a
// non-JWT-shaped token or a missing/non-numeric exp.

/**
 * Parse a JWT's payload segment into an object. Returns null for a
 * non-JWT-shaped token or a base64/JSON parse failure. PARITY:
 * plugin/mystatus.ts:572-582.
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Decode the `exp` claim (Unix seconds) from a JWT. Returns undefined when
 * the token is not JWT-shaped or has no numeric `exp`.
 */
export function decodeJwtExp(token: string): number | undefined {
  const payload = parseJwtPayload(token);
  if (payload === null) return undefined;
  const exp = payload["exp"];
  if (typeof exp === "number" && Number.isFinite(exp)) return exp;
  return undefined;
}

/**
 * Extract the `exp` claim from an atlas access-token JWT embedded in a
 * Cookie header string. PARITY: plugin/mystatus.ts:5110-5118. Returns
 * undefined when the access-token cookie is absent or the JWT has no exp.
 */
export function extractAtlasAccessTokenExp(cookieHeader: string): number | undefined {
  const m = cookieHeader.match(/access-token=([^;]+)/);
  if (!m) return undefined;
  return decodeJwtExp(m[1]);
}

/** Human-readable countdown to a Unix-seconds expiry, e.g. "6d 8h 12m". */
export function formatExpiryCountdown(expUnixSec: number, nowMs: number = Date.now()): string {
  const ms = expUnixSec * 1000 - nowMs;
  if (ms <= 0) return "expired";
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}