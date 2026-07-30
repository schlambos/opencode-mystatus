// Antigravity Tools env-precedence + auto-discovery status (todo 22).
//
// Reports ONLY booleans: which `ANTIGRAVITY_TOOLS_*` env vars are SET and
// whether `~/.antigravity_tools/gui_config.json` exists. NEVER reads or
// returns env var VALUES — the IPC payload is regex-scanned by the test
// suite to assert no secret prefixes (sk-, ghp_, github_pat_, eyJ) leak
// through. The gui_config.json discovery is strictly read-only: this module
// never writes to gui_config.json or antigravity-accounts.json.
//
// Env precedence is documented in mystatus.example.json:48-66 and the README
// Google/Antigravity section — env vars override config values. The UI uses
// these booleans to badge each field "from env" vs "from config" so the user
// knows whether their config value is actually in effect.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AntigravityEnvStatus } from "../shared/ipc.js";

const ENV_BASE_URL = "ANTIGRAVITY_TOOLS_BASE_URL";
const ENV_API_KEY = "ANTIGRAVITY_TOOLS_API_KEY";
const ENV_ADMIN_PASSWORD = "ANTIGRAVITY_TOOLS_ADMIN_PASSWORD";
const ENV_USAGE_HOURS = "ANTIGRAVITY_TOOLS_USAGE_HOURS";

function isSet(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0;
}

/**
 * Resolve the gui_config.json path lazily so tests that redirect HOME
 * after import see the test's homedir, not the one captured at module load.
 */
function resolveGuiConfigPath(): string {
  return join(homedir(), ".antigravity_tools", "gui_config.json");
}

/**
 * Build the env + discovery status. Booleans only — never env values. The
 * gui_config.json check is a plain existence test (read-only); this module
 * never opens the file for reading its contents, only `existsSync`.
 */
export function getAntigravityEnvStatus(): AntigravityEnvStatus {
  const guiConfigPath = resolveGuiConfigPath();
  return {
    baseUrlFromEnv: isSet(ENV_BASE_URL),
    apiKeyFromEnv: isSet(ENV_API_KEY),
    adminPasswordFromEnv: isSet(ENV_ADMIN_PASSWORD),
    usageHoursFromEnv: isSet(ENV_USAGE_HOURS),
    guiConfigFound: existsSync(guiConfigPath),
    guiConfigPath,
  };
}

/** Exposed for tests so the path can be asserted without hardcoding homedir(). */
export function guiConfigPath(): string {
  return resolveGuiConfigPath();
}