// Tests for credential file writers + test-connection (todo 13).
//
// HOME/USERPROFILE are redirected to a tmp dir BEFORE importing cred-files.ts
// so the module-level LEGACY_CONFIG_DIR / OPENCODE_MULTI_PROFILES_ROOT
// (computed from homedir()) point at the throwaway location. The plugin reads
// credential files from these same dirs; an unredirected test would surface
// the developer's real credentials and could not assert on writes.
//
// No Electron, no GUI, no real provider queries. Vitest only with a stubbed
// coreApi for testProvider.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-cred-"));
process.env["HOME"] = TMP_HOME;
process.env["USERPROFILE"] = TMP_HOME;
delete process.env["OPENCODE_CONFIG_DIR"];
delete process.env["XDG_DATA_HOME"];

const credFilesModule = await import("./cred-files.js");
const {
  resolveCredentialWritePath,
  writeCredentialFile,
  deleteCredentialFile,
  testProvider,
  parseJwtPayload,
  decodeJwtExp,
  extractAtlasAccessTokenExp,
  formatExpiryCountdown,
} = credFilesModule;

function configDir(): string {
  return join(TMP_HOME, ".config", "opencode");
}

function profilesRoot(): string {
  return join(TMP_HOME, "Library", "Application Support", "opencode-multi", "profiles");
}

function profileDir(name: string): string {
  return join(profilesRoot(), name);
}

// macOS resolves /var → /private/var via realpathSync inside candidateConfigDirs,
// so test comparisons must use the real path too.
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

beforeEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
  rmSync(profilesRoot(), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
  rmSync(profilesRoot(), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveCredentialWritePath
// ---------------------------------------------------------------------------

describe("resolveCredentialWritePath", () => {
  it("resolves to the legacy ~/.config/opencode/ dir when no copy exists", () => {
    expect(resolveCredentialWritePath("atlas-cookies.json")).toBe(
      real(join(configDir(), "atlas-cookies.json")),
    );
  });

  it("overwrites the existing readable copy in the legacy dir", () => {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(join(configDir(), "atlas-cookies.json"), '{"cookie":"old"}', "utf8");
    expect(resolveCredentialWritePath("atlas-cookies.json")).toBe(
      real(join(configDir(), "atlas-cookies.json")),
    );
  });

  it("prefers an existing profile copy over the legacy dir", () => {
    mkdirSync(profileDir("work"), { recursive: true });
    writeFileSync(join(profileDir("work"), "atlas-cookies.json"), '{"cookie":"profile"}', "utf8");
    expect(resolveCredentialWritePath("atlas-cookies.json")).toBe(
      real(join(profileDir("work"), "atlas-cookies.json")),
    );
  });

  it("prefers OPENCODE_CONFIG_DIR over profile and legacy dirs", () => {
    const envDir = mkdtempSync(join(tmpdir(), "mystatus-env-"));
    mkdirSync(envDir, { recursive: true });
    writeFileSync(join(envDir, "atlas-cookies.json"), '{"cookie":"env"}', "utf8");
    process.env["OPENCODE_CONFIG_DIR"] = envDir;
    try {
      expect(resolveCredentialWritePath("atlas-cookies.json")).toBe(
        real(join(envDir, "atlas-cookies.json")),
      );
    } finally {
      delete process.env["OPENCODE_CONFIG_DIR"];
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// writeCredentialFile
// ---------------------------------------------------------------------------

describe("writeCredentialFile", () => {
  it("writes the exact JSON payload atomically", () => {
    const res = writeCredentialFile("atlas-cookies.json", { cookie: "access-token=abc" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path.endsWith("atlas-cookies.json")).toBe(true);
    expect(JSON.parse(readFileSync(res.path, "utf8"))).toEqual({ cookie: "access-token=abc" });
  });

  it("writes with mode 0o600 (skipped on Windows with a reason)", () => {
    writeCredentialFile("atlas-cookies.json", { cookie: "x" });
    if (process.platform === "win32") {
      console.log("[skip] file mode 0o600 assertion not applicable on win32");
      return;
    }
    expect(statSync(real(join(configDir(), "atlas-cookies.json"))).mode & 0o777).toBe(0o600);
  });

  it("creates the config dir with mode 0o700 when missing", () => {
    writeCredentialFile("atlas-cookies.json", { cookie: "x" });
    if (process.platform === "win32") return;
    expect(statSync(real(configDir())).mode & 0o777).toBe(0o700);
  });

  it("leaves no .tmp residue after a successful write", () => {
    writeCredentialFile("atlas-cookies.json", { cookie: "x" });
    const files = readdirSync(real(configDir()));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("overwrites an existing file in the legacy dir", () => {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(join(configDir(), "atlas-cookies.json"), '{"cookie":"old"}', "utf8");
    const res = writeCredentialFile("atlas-cookies.json", { cookie: "new" });
    expect(res.ok).toBe(true);
    expect(JSON.parse(readFileSync(real(join(configDir(), "atlas-cookies.json")), "utf8"))).toEqual({
      cookie: "new",
    });
  });

  it("overwrites an existing file in a profile dir when that is the readable copy", () => {
    mkdirSync(profileDir("work"), { recursive: true });
    writeFileSync(join(profileDir("work"), "atlas-cookies.json"), '{"cookie":"old"}', "utf8");
    const res = writeCredentialFile("atlas-cookies.json", { cookie: "new" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(real(join(profileDir("work"), "atlas-cookies.json")));
    expect(JSON.parse(readFileSync(res.path, "utf8"))).toEqual({ cookie: "new" });
    // Legacy dir should NOT have been written.
    expect(existsSync(join(configDir(), "atlas-cookies.json"))).toBe(false);
  });

  it("verify-after-write catches a simulated silent failure", () => {
    // Simulate a silent write failure by making the config dir read-only so
    // the atomic tmp+rename cannot complete. The original file (if any)
    // stays intact and the error surfaces to the caller.
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(join(configDir(), "atlas-cookies.json"), '{"cookie":"old"}', {
      mode: 0o600,
    });
    if (process.platform === "win32") {
      // chmod-based read-only is unreliable on win32; skip with a reason.
      console.log("[skip] verify-after-write EACCES simulation not applicable on win32");
      return;
    }
    chmodSync(configDir(), 0o500);
    try {
      const res = writeCredentialFile("atlas-cookies.json", { cookie: "fresh" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      // The original file is intact — the write was refused.
      expect(JSON.parse(readFileSync(join(configDir(), "atlas-cookies.json"), "utf8"))).toEqual({
        cookie: "old",
      });
    } finally {
      chmodSync(configDir(), 0o700);
    }
  });

  it("refuses a traversal path outside the candidate dirs", () => {
    // A malicious renderer could send a name with path segments. The typed
    // CredentialFileName union forbids this at compile time, but the IPC
    // handler casts at runtime, so writeCredentialFile must refuse a path
    // that resolves outside the candidate dirs.
    const res = writeCredentialFile("../../evil.json" as never, { cookie: "x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("outside candidate config dirs");
  });
});

// ---------------------------------------------------------------------------
// deleteCredentialFile
// ---------------------------------------------------------------------------

describe("deleteCredentialFile", () => {
  it("removes an existing credential file", () => {
    writeCredentialFile("atlas-cookies.json", { cookie: "x" });
    const path = join(configDir(), "atlas-cookies.json");
    expect(existsSync(path)).toBe(true);
    const res = deleteCredentialFile("atlas-cookies.json");
    expect(res.ok).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("reports ok when the file is already absent", () => {
    const res = deleteCredentialFile("atlas-cookies.json");
    expect(res.ok).toBe(true);
  });

  it("deletes the resolved (profile) copy, not the legacy copy", () => {
    mkdirSync(profileDir("work"), { recursive: true });
    writeFileSync(join(profileDir("work"), "atlas-cookies.json"), '{"cookie":"profile"}', "utf8");
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(join(configDir(), "atlas-cookies.json"), '{"cookie":"legacy"}', "utf8");

    const expectedDir = real(profileDir("work"));
    const res = deleteCredentialFile("atlas-cookies.json");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(join(expectedDir, "atlas-cookies.json"));
    expect(existsSync(join(profileDir("work"), "atlas-cookies.json"))).toBe(false);
    // Legacy copy survives — the core's findReadable would still find it.
    expect(existsSync(join(configDir(), "atlas-cookies.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// testProvider
// ---------------------------------------------------------------------------

describe("testProvider", () => {
  function makeStubApi(getViewModel: (args: unknown) => unknown): {
    api: import("./core.js").CoreApi;
    getViewModel: ReturnType<typeof vi.fn>;
  } {
    const fn = vi.fn(getViewModel);
    return {
      api: { getViewModel: fn } as unknown as import("./core.js").CoreApi,
      getViewModel: fn,
    };
  }

  it("returns {ok} when the fresh query has no error/stale issue for the provider", async () => {
    const { api, getViewModel } = makeStubApi(() => ({
      summary: { accounts: 1, green: 1, yellow: 0, red: 0 },
      providers: [{ name: "AtlasCloud", minRemaining: 100, windows: [] }],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [],
      health: { queried: 1, rendered: 1, stale: 0, failed: 0, unconfigured: 0 },
    }));
    const res = await testProvider("atlascloud", api);
    expect(res.ok).toBe(true);
    expect(getViewModel).toHaveBeenCalledWith({ only: "atlascloud", fresh: true });
  });

  it("maps a core {error} result to {ok:false, error}", async () => {
    const { api } = makeStubApi(() => ({ error: "boom" }));
    const res = await testProvider("atlascloud", api);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("boom");
  });

  it("maps an error-kind issue for the provider to {ok:false, error}", async () => {
    const { api } = makeStubApi(() => ({
      summary: { accounts: 1, green: 0, yellow: 0, red: 1 },
      providers: [],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [
        { provider: "AtlasCloud", kind: "error", detail: "401 unauthorized" },
      ],
      health: { queried: 1, rendered: 0, stale: 0, failed: 1, unconfigured: 0 },
    }));
    const res = await testProvider("atlascloud", api);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("401 unauthorized");
  });

  it("maps a stale-kind issue to {ok:false, error} with the stale prefix", async () => {
    const { api } = makeStubApi(() => ({
      summary: { accounts: 1, green: 0, yellow: 1, red: 0 },
      providers: [{ name: "AtlasCloud", minRemaining: 50, windows: [], stale: { ageMs: 3_600_000 } }],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [
        {
          provider: "AtlasCloud",
          kind: "stale",
          detail: "token expired",
          ageMs: 3_600_000,
        },
      ],
      health: { queried: 1, rendered: 1, stale: 1, failed: 0, unconfigured: 0 },
    }));
    const res = await testProvider("atlascloud", api);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("stale");
    expect(res.error).toContain("token expired");
  });

  it("ignores unconfigured-kind issues (no credential file is not a test failure)", async () => {
    const { api } = makeStubApi(() => ({
      summary: { accounts: 0, green: 0, yellow: 0, red: 0 },
      providers: [],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [
        { provider: "AtlasCloud", kind: "unconfigured", detail: "no credentials found" },
      ],
      health: { queried: 0, rendered: 0, stale: 0, failed: 0, unconfigured: 1 },
    }));
    const res = await testProvider("atlascloud", api);
    // An unconfigured issue means the credential file is not yet present;
    // testProvider returns ok:true because there is no error/stale to report.
    expect(res.ok).toBe(true);
  });

  it("matches the provider title case-insensitively", async () => {
    const { api } = makeStubApi(() => ({
      summary: { accounts: 1, green: 0, yellow: 0, red: 1 },
      providers: [],
      errors: [],
      alerts: [],
      threshold: 25,
      issues: [
        { provider: "OpenCode Go+Zen", kind: "error", detail: "auth cookie expired" },
      ],
      health: { queried: 1, rendered: 0, stale: 0, failed: 1, unconfigured: 0 },
    }));
    const res = await testProvider("opencode-go", api);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("auth cookie expired");
  });
});

// ---------------------------------------------------------------------------
// JWT exp helpers
// ---------------------------------------------------------------------------

describe("parseJwtPayload", () => {
  it("decodes a well-formed JWT payload segment", () => {
    // Header.{"exp":1700000000}.signature — base64url payload is "eyJleHAiOjE3MDAwMDAwMDB9".
    const token = `header.eyJleHAiOjE3MDAwMDAwMDB9.signature`;
    expect(parseJwtPayload(token)).toEqual({ exp: 1700000000 });
  });

  it("returns null for a non-JWT-shaped string", () => {
    expect(parseJwtPayload("not-a-jwt")).toBeNull();
    expect(parseJwtPayload("a.b")).toBeNull();
    expect(parseJwtPayload("a.b.c.d")).toBeNull();
  });

  it("returns null for invalid base64/JSON", () => {
    expect(parseJwtPayload("a.!!!.b")).toBeNull();
  });
});

describe("decodeJwtExp", () => {
  it("returns the exp claim as a number", () => {
    const token = `header.eyJleHAiOjE3MDAwMDAwMDB9.signature`;
    expect(decodeJwtExp(token)).toBe(1700000000);
  });

  it("returns undefined when exp is absent", () => {
    const token = `header.eyJzdWIiOiJ4In0.signature`;
    expect(decodeJwtExp(token)).toBeUndefined();
  });

  it("returns undefined when exp is not a number", () => {
    const token = `header.eyJleHAiOiJzdHJpbmcifQ.signature`;
    expect(decodeJwtExp(token)).toBeUndefined();
  });

  it("returns undefined for a non-JWT-shaped token", () => {
    expect(decodeJwtExp("not-a-jwt")).toBeUndefined();
  });
});

describe("extractAtlasAccessTokenExp", () => {
  it("extracts exp from an access-token JWT in a cookie header", () => {
    const header = `access-token=header.eyJleHAiOjE3MDAwMDAwMDB9.signature; g_state=AAA`;
    expect(extractAtlasAccessTokenExp(header)).toBe(1700000000);
  });

  it("returns undefined when access-token is absent", () => {
    expect(extractAtlasAccessTokenExp("g_state=AAA")).toBeUndefined();
  });

  it("returns undefined when the access-token value is not a JWT", () => {
    expect(extractAtlasAccessTokenExp("access-token=not-a-jwt")).toBeUndefined();
  });
});

describe("formatExpiryCountdown", () => {
  it("formats days/hours/minutes", () => {
    const now = 1_000_000_000_000;
    expect(formatExpiryCountdown((now + 5 * 86_400_000 + 3 * 3_600_000 + 12 * 60_000) / 1000, now)).toBe(
      "5d 3h 12m",
    );
  });

  it("formats hours/minutes when under a day", () => {
    const now = 1_000_000_000_000;
    expect(formatExpiryCountdown((now + 3 * 3_600_000 + 12 * 60_000) / 1000, now)).toBe("3h 12m");
  });

  it("formats minutes when under an hour", () => {
    const now = 1_000_000_000_000;
    expect(formatExpiryCountdown((now + 12 * 60_000) / 1000, now)).toBe("12m");
  });

  it("returns 'expired' when the expiry is in the past", () => {
    const now = 1_000_000_000_000;
    expect(formatExpiryCountdown((now - 1000) / 1000, now)).toBe("expired");
  });
});