// Antigravity Tools env-precedence + auto-discovery status (todo 22).
//
// Acceptance: env-set booleans are reported WITHOUT values — regex-scan the
// serialized IPC payload for the literal env values and assert zero hits.
// Also: gui_config.json discovery is read-only (existence check only), and
// the module never writes to gui_config.json or antigravity-accounts.json.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAntigravityEnvStatus, guiConfigPath } from "./antigravity-settings.js";

const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-agt-"));

const ENV_VARS = [
  "ANTIGRAVITY_TOOLS_BASE_URL",
  "ANTIGRAVITY_TOOLS_API_KEY",
  "ANTIGRAVITY_TOOLS_ADMIN_PASSWORD",
  "ANTIGRAVITY_TOOLS_USAGE_HOURS",
] as const;

// Secret-shaped values that MUST NEVER appear in the IPC payload.
const SECRET_VALUES = [
  "sk-test-secret-api-key-value-123456",
  "ghp_testGithubPatValue7890",
  "github_pat_testGithubFineGrainedValue",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0b2tlbiJ9.signature",
  "http://127.0.0.1:8045/v1",
  "168",
  "admin-pw-super-secret",
];

function clearEnv(): void {
  for (const name of ENV_VARS) delete process.env[name];
}

describe("getAntigravityEnvStatus", () => {
  beforeEach(() => {
    clearEnv();
    process.env["HOME"] = TMP_HOME;
    process.env["USERPROFILE"] = TMP_HOME;
  });

  afterEach(() => {
    clearEnv();
    rmSync(join(TMP_HOME, ".antigravity_tools"), { recursive: true, force: true });
  });

  it("reports all-false when no env vars are set and gui_config.json is absent", () => {
    const status = getAntigravityEnvStatus();
    expect(status.baseUrlFromEnv).toBe(false);
    expect(status.apiKeyFromEnv).toBe(false);
    expect(status.adminPasswordFromEnv).toBe(false);
    expect(status.usageHoursFromEnv).toBe(false);
    expect(status.guiConfigFound).toBe(false);
    expect(status.guiConfigPath).toBe(guiConfigPath());
  });

  it("reports true only for env vars that are SET (non-empty), never their values", () => {
    process.env["ANTIGRAVITY_TOOLS_BASE_URL"] = SECRET_VALUES[4];
    process.env["ANTIGRAVITY_TOOLS_API_KEY"] = SECRET_VALUES[0];
    process.env["ANTIGRAVITY_TOOLS_ADMIN_PASSWORD"] = SECRET_VALUES[6];
    process.env["ANTIGRAVITY_TOOLS_USAGE_HOURS"] = SECRET_VALUES[5];

    const status = getAntigravityEnvStatus();
    expect(status.baseUrlFromEnv).toBe(true);
    expect(status.apiKeyFromEnv).toBe(true);
    expect(status.adminPasswordFromEnv).toBe(true);
    expect(status.usageHoursFromEnv).toBe(true);

    // The critical security assertion: the serialized payload contains NONE
    // of the literal env values. Regex-scan for every secret-shaped string.
    const serialized = JSON.stringify(status);
    for (const secret of SECRET_VALUES) {
      expect(serialized).not.toContain(secret);
    }
    // Also assert no common secret prefix leaks through at all.
    expect(serialized).not.toMatch(/sk-/);
    expect(serialized).not.toMatch(/ghp_/);
    expect(serialized).not.toMatch(/github_pat_/);
    expect(serialized).not.toMatch(/eyJ/);
  });

  it("treats an empty-string env var as unset", () => {
    process.env["ANTIGRAVITY_TOOLS_API_KEY"] = "";
    const status = getAntigravityEnvStatus();
    expect(status.apiKeyFromEnv).toBe(false);
  });

  it("reports guiConfigFound=true when ~/.antigravity_tools/gui_config.json exists (read-only)", () => {
    const dir = join(TMP_HOME, ".antigravity_tools");
    const file = join(dir, "gui_config.json");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{"port": 8045}', "utf8");

    const status = getAntigravityEnvStatus();
    expect(status.guiConfigFound).toBe(true);
    expect(status.guiConfigPath).toBe(file);
  });

  it("never reads or returns the contents of gui_config.json", () => {
    const dir = join(TMP_HOME, ".antigravity_tools");
    const file = join(dir, "gui_config.json");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const secretContent = '{"apiKey":"sk-should-not-leak-from-file"}';
    writeFileSync(file, secretContent, "utf8");

    const status = getAntigravityEnvStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("sk-should-not-leak-from-file");
    expect(serialized).not.toContain(secretContent);
  });
});