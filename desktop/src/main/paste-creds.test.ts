// Tests for guided paste (todo 12): Copilot PAT + Poe API key writers and
// auth:status. HOME/USERPROFILE are redirected to a tmp dir BEFORE importing
// paste-creds.ts so the module-level CONFIG_DIR/DATA_DIR_LEGACY (computed
// from homedir()) point at the throwaway location. The plugin reads auth.json
// and credential files from these same dirs; an unredirected test would
// surface the developer's real credentials and could not assert on writes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-paste-"));
process.env["HOME"] = TMP_HOME;
process.env["USERPROFILE"] = TMP_HOME;
delete process.env["OPENCODE_CONFIG_DIR"];
delete process.env["XDG_DATA_HOME"];

const {
  writeCopilotPAT,
  writePoeApiKey,
  clearCredentialFile,
  getAuthStatus,
  resolveCredentialWritePath,
  COPILOT_PAT_URL,
  POE_API_KEY_URL,
} = await import("./paste-creds.js");

function configDir(): string {
  return join(TMP_HOME, ".config", "opencode");
}

function dataDir(): string {
  return join(TMP_HOME, ".local", "share", "opencode");
}

function copilotFile(): string {
  return join(configDir(), "copilot-quota-token.json");
}

function poeFile(): string {
  return join(configDir(), "poe-api-key.json");
}

function authJsonFile(): string {
  return join(dataDir(), "auth.json");
}

beforeEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
  rmSync(dataDir(), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(configDir(), { recursive: true, force: true });
  rmSync(dataDir(), { recursive: true, force: true });
});

describe("deep-link URLs", () => {
  it("Copilot PAT URL points at the beta token settings page", () => {
    expect(COPILOT_PAT_URL).toBe("https://github.com/settings/tokens?type=beta");
  });

  it("Poe API key URL points at the poe key page", () => {
    expect(POE_API_KEY_URL).toBe("https://poe.com/api_key");
  });
});

describe("writeCopilotPAT", () => {
  it("writes the exact plugin JSON schema {token, username, tier}", () => {
    const res = writeCopilotPAT({ token: "github_pat_test123", username: "octocat", tier: "pro" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(copilotFile());
    const written = JSON.parse(readFileSync(copilotFile(), "utf8"));
    expect(written).toEqual({ token: "github_pat_test123", username: "octocat", tier: "pro" });
  });

  it("accepts all three tiers", () => {
    for (const tier of ["pro", "pro+", "max"] as const) {
      rmSync(configDir(), { recursive: true, force: true });
      const res = writeCopilotPAT({ token: "t", username: "u", tier });
      expect(res.ok).toBe(true);
    }
  });

  it("rejects an invalid tier without creating the file", () => {
    const res = writeCopilotPAT({ token: "t", username: "u", tier: "business" as never });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("tier");
    expect(existsSync(copilotFile())).toBe(false);
  });

  it("rejects an empty token without touching an existing file", () => {
    mkdirSync(configDir(), { recursive: true });
    const existing = { token: "keep", username: "u", tier: "pro" };
    writeFileSync(copilotFile(), JSON.stringify(existing), "utf8");
    const beforeMtime = statSync(copilotFile()).mtimeMs;

    const res = writeCopilotPAT({ token: "  ", username: "u", tier: "pro" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("token");

    const afterMtime = statSync(copilotFile()).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);
    expect(JSON.parse(readFileSync(copilotFile(), "utf8"))).toEqual(existing);
  });

  it("rejects an empty username", () => {
    const res = writeCopilotPAT({ token: "t", username: "", tier: "pro" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("username");
  });

  it("writes with mode 0o600 (skipped on Windows with a reason)", () => {
    writeCopilotPAT({ token: "t", username: "u", tier: "pro" });
    if (process.platform === "win32") {
      console.log("[skip] file mode 0o600 assertion not applicable on win32");
      return;
    }
    expect(statSync(copilotFile()).mode & 0o777).toBe(0o600);
  });

  it("creates the config dir with mode 0o700 when missing", () => {
    writeCopilotPAT({ token: "t", username: "u", tier: "pro" });
    if (process.platform === "win32") return;
    expect(statSync(configDir()).mode & 0o777).toBe(0o700);
  });

  it("leaves no .tmp residue after a successful write", () => {
    writeCopilotPAT({ token: "t", username: "u", tier: "pro" });
    const files = readdirSync(configDir());
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

describe("writePoeApiKey", () => {
  it("writes the exact plugin JSON schema {apiKey}", () => {
    const res = writePoeApiKey({ apiKey: "sk-poe-test123" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(poeFile());
    expect(JSON.parse(readFileSync(poeFile(), "utf8"))).toEqual({ apiKey: "sk-poe-test123" });
  });

  it("rejects an empty apiKey without creating the file", () => {
    const res = writePoeApiKey({ apiKey: "" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("apiKey");
    expect(existsSync(poeFile())).toBe(false);
  });

  it("writes with mode 0o600 (skipped on Windows with a reason)", () => {
    writePoeApiKey({ apiKey: "k" });
    if (process.platform === "win32") {
      console.log("[skip] file mode 0o600 assertion not applicable on win32");
      return;
    }
    expect(statSync(poeFile()).mode & 0o777).toBe(0o600);
  });
});

describe("clearCredentialFile", () => {
  it("removes an existing credential file", () => {
    writePoeApiKey({ apiKey: "k" });
    expect(existsSync(poeFile())).toBe(true);
    const res = clearCredentialFile("poe-api-key.json");
    expect(res.ok).toBe(true);
    expect(existsSync(poeFile())).toBe(false);
  });

  it("reports ok when the file is already absent", () => {
    const res = clearCredentialFile("poe-api-key.json");
    expect(res.ok).toBe(true);
  });
});

describe("resolveCredentialWritePath", () => {
  it("resolves under the redirected HOME config dir", () => {
    expect(resolveCredentialWritePath("copilot-quota-token.json")).toBe(copilotFile());
  });
});

describe("getAuthStatus", () => {
  it("returns empty lists when nothing is configured", () => {
    const s = getAuthStatus();
    expect(s.authJson).toEqual([]);
    expect(s.credentialFiles).toEqual([]);
  });

  it("reports provider ids present in auth.json (presence only)", () => {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(
      authJsonFile(),
      JSON.stringify({
        openai: { type: "oauth", access: "sk-test" },
        "github-copilot": { type: "oauth", access: "gho_test" },
        poe: { type: "api", key: "sk-poe" },
        "unknown-provider": { type: "oauth", access: "x" },
      }),
      "utf8",
    );
    const s = getAuthStatus();
    expect(s.authJson).toContain("openai");
    expect(s.authJson).toContain("github-copilot");
    expect(s.authJson).toContain("poe");
    expect(s.authJson).not.toContain("unknown-provider");
  });

  it("reports credential files present under config dir", () => {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(copilotFile(), JSON.stringify({ token: "t", username: "u", tier: "pro" }), "utf8");
    writeFileSync(poeFile(), JSON.stringify({ apiKey: "k" }), "utf8");
    const s = getAuthStatus();
    expect(s.credentialFiles).toContain("copilot-quota-token.json");
    expect(s.credentialFiles).toContain("poe-api-key.json");
  });

  it("NEVER returns secret values — serialized payload has no secret prefixes", () => {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(
      authJsonFile(),
      JSON.stringify({
        openai: { type: "oauth", access: "sk-secret-openai-token-1234567890" },
        "github-copilot": { type: "oauth", access: "gho_secret-copilot" },
        poe: { type: "api", key: "sk-poe-secret-key" },
      }),
      "utf8",
    );
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(
      copilotFile(),
      JSON.stringify({ token: "github_pat_secret-pat-token", username: "u", tier: "pro" }),
      "utf8",
    );
    writeFileSync(poeFile(), JSON.stringify({ apiKey: "sk-poe-secret" }), "utf8");

    const s = getAuthStatus();
    const serialized = JSON.stringify(s);
    // The payload must contain only provider-id strings and file names —
    // never the secret values themselves.
    expect(serialized).not.toContain("sk-secret-openai-token");
    expect(serialized).not.toContain("gho_secret-copilot");
    expect(serialized).not.toContain("sk-poe-secret");
    expect(serialized).not.toContain("github_pat_secret-pat-token");
    // Regex-scan for any token-value prefixes that should never appear.
    expect(/sk-[\w-]{6,}/.test(serialized)).toBe(false);
    expect(/ghp_[\w-]{6,}/.test(serialized)).toBe(false);
    expect(/github_pat_[\w-]{6,}/.test(serialized)).toBe(false);
    expect(/gho_[\w-]{6,}/.test(serialized)).toBe(false);
    expect(/eyJ[\w-]{6,}/.test(serialized)).toBe(false);
  });

  it("does not throw on a malformed auth.json", () => {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(authJsonFile(), "{ not json", "utf8");
    const s = getAuthStatus();
    expect(s.authJson).toEqual([]);
  });
});