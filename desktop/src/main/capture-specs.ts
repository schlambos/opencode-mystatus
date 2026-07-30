// Per-provider cookie capture configs (todo 11).
//
// Declarative spec per cookie provider: id, display name, portal URL,
// allowedOrigins (portal + its known SSO/IdP origins), sentinelCookies,
// optional urlPattern (opencode-go /workspace/<uuid>), and an extraction
// function mapping captured cookies → the EXACT plugin file JSON written
// to ~/.config/opencode/<filename>.
//
// Schemas are mirrored from plugin/mystatus.ts (the plugin core is the
// single source of truth — the desktop app MUST NOT invent new formats):
//   - atlas:    plugin/mystatus.ts:5002-5005, 5298-5305  ({cookie}; accountUuid auto-resolved)
//   - byteplus: plugin/mystatus.ts:4849-4861              ({cookie})
//   - mistral:  plugin/mystatus.ts:4670-4717             ({cookie} | {accounts:[{alias,cookie}]})
//   - ollama:   plugin/mystatus.ts:5447-5459, 5549-5556  ({cookie}; __Secure-session required)
//   - longcat:  plugin/mystatus.ts:5643-5733             ({passportToken, region} | {cookie})
//   - qwencloud:plugin/mystatus.ts:4246-4332             ({ticket, aliyunPk, isg, esmTicket?})
//   - stepfun:  plugin/mystatus.ts:4025-4083            ({oasisToken, oasisWebid, sessionToken?})
//   - opencode-go: plugin/mystatus.ts:2393-2399, 2630-2667 ({accounts:[{id,workspaceId,authCookie}]} | single)
//
// Full-header reconstruction: cookies.map(c => `${c.name}=${c.value}`).join('; ')
// (Electron's ses.cookies.get returns individual cookies; the plugin reads a
// full Cookie header string for most providers).
//
// Security: cookie names+values are NEVER logged. Extraction functions are
// pure — they take a CapturedCookie[] and return a typed result; the caller
// (cred-files.ts, todo 13) handles the atomic write + verify-after-write.

import type { CaptureSpec, CapturedCookie } from "../shared/ipc.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Provider id — matches the core PROVIDERS registry (plugin/mystatus.ts:6777-6796). */
export type CookieProviderId =
  | "atlascloud"
  | "byteplus"
  | "mistral"
  | "ollama"
  | "longcat"
  | "qwencloud"
  | "stepfun"
  | "opencode-go";

/** Filename written to ~/.config/opencode/<name>. */
export type CredentialFileName =
  | "atlas-cookies.json"
  | "byteplus-cookies.json"
  | "mistral-cookies.json"
  | "ollama-cookies.json"
  | "longcat-cookies.json"
  | "qwencloud-cookies.json"
  | "stepfun-cookies.json"
  | "opencode-go.json";

/**
 * Result of an extraction function.
 *
 * - `ok`: the JSON payload to write verbatim.
 * - `merge`: a merge function — given the existing file's parsed contents
 *   (or `null` if absent/empty), returns the new merged JSON to write. Used
 *   by mistral and opencode-go which support multi-account arrays.
 * - `error`: a per-field error listing the missing cookie(s). The caller
 *   REFUSES the write and surfaces this to the UI; no partial file is created.
 */
export type ExtractionResult =
  | { readonly ok: true; readonly json: Record<string, unknown> }
  | {
      readonly ok: true;
      readonly merge: (existing: Record<string, unknown> | null) => Record<string, unknown>;
    }
  | { readonly ok: false; readonly error: string };

/** A complete per-provider capture spec. */
export interface ProviderCaptureSpec extends CaptureSpec {
  readonly id: CookieProviderId;
  readonly displayName: string;
  /** Filename under ~/.config/opencode/. */
  readonly fileName: CredentialFileName;
  /** Inline setup help (from README provider sections). */
  readonly helpText: string;
  /** Portal URL for the fallback "open externally" path (todo 10 fallback). */
  readonly portalUrl: string;
  /**
   * Map captured cookies → plugin file JSON. Pure; never throws — returns
   * `{ok:false, error}` for missing required cookies.
   *
   * For opencode-go, `finalUrl` carries the workspaceId (parsed from the
   * `/workspace/<uuid>` URL pattern); other providers ignore it.
   */
  readonly extract: (
    cookies: readonly CapturedCookie[],
    finalUrl: string | undefined,
  ) => ExtractionResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reconstruct a full Cookie header from individual cookies. */
export function cookieHeader(cookies: readonly CapturedCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Find a single cookie value by name (first match). */
function cookieValue(
  cookies: readonly CapturedCookie[],
  name: string,
): string | undefined {
  return cookies.find((c) => c.name === name)?.value;
}

/** Build a per-field missing-cookie error. */
function missingError(provider: string, names: readonly string[]): string {
  return `${provider}: missing required cookie(s): ${names.join(", ")}`;
}

// Common federated IdP origins — included in idpOrigins so SSO logins do not
// dead-end inside the capture window's navigation allowlist.
const COMMON_IDP_ORIGINS = [
  "https://accounts.google.com",
  "https://github.com",
  "https://login.microsoftonline.com",
  "https://appleid.apple.com",
] as const;

const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 minutes — sign-in can be slow.

// ---------------------------------------------------------------------------
// Per-provider specs
// ---------------------------------------------------------------------------

// (1) AtlasCloud — console.atlascloud.ai
// Plugin reads {cookie} with access-token= JWT; accountUuid auto-resolved
// via /current-user (plugin/mystatus.ts:5317-5328), so we omit it.
const atlascloud: ProviderCaptureSpec = {
  id: "atlascloud",
  displayName: "AtlasCloud",
  fileName: "atlas-cookies.json",
  portalUrl: "https://console.atlascloud.ai",
  startUrl: "https://console.atlascloud.ai",
  allowedOrigins: ["https://console.atlascloud.ai", "https://www.atlascloud.ai"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["access-token"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://console.atlascloud.ai. The app captures your session " +
    "(including the access-token cookie) and writes atlas-cookies.json. " +
    "accountUuid is auto-resolved by the plugin via /current-user.",
  extract: (cookies) => {
    const header = cookieHeader(cookies);
    if (!/access-token=/.test(header)) {
      return { ok: false, error: missingError("AtlasCloud", ["access-token"]) };
    }
    return { ok: true, json: { cookie: header } };
  },
};

// (2) BytePlus — console.byteplus.com
// Plugin reads {cookie} and extracts csrfToken via /csrfToken=([^;]+)/
// (plugin/mystatus.ts:4863-4866).
const byteplus: ProviderCaptureSpec = {
  id: "byteplus",
  displayName: "BytePlus (Ark Coding Plan)",
  fileName: "byteplus-cookies.json",
  portalUrl: "https://console.byteplus.com",
  startUrl: "https://console.byteplus.com",
  allowedOrigins: ["https://console.byteplus.com"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["csrfToken"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://console.byteplus.com. The app captures your session " +
    "(including the csrfToken cookie) and writes byteplus-cookies.json.",
  extract: (cookies) => {
    const header = cookieHeader(cookies);
    if (!/csrfToken=/.test(header)) {
      return { ok: false, error: missingError("BytePlus", ["csrfToken"]) };
    }
    return { ok: true, json: { cookie: header } };
  },
};

// (3) Mistral — console.mistral.ai
// Multi-account: {accounts:[{alias, cookie}]}. After capture, the caller
// offers an alias prompt and MERGES into the existing accounts array,
// preserving entries (plugin/mystatus.ts:4670-4717).
const mistral: ProviderCaptureSpec = {
  id: "mistral",
  displayName: "Mistral (Vibe Usage)",
  fileName: "mistral-cookies.json",
  portalUrl: "https://console.mistral.ai",
  startUrl: "https://console.mistral.ai",
  allowedOrigins: ["https://console.mistral.ai"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["csrftoken"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://console.mistral.ai. The app captures your session " +
    "(including the csrftoken cookie). For multiple organizations, sign in " +
    "to each in a separate browser profile and capture each — they merge " +
    "into the accounts array in mistral-cookies.json.",
  extract: (cookies) => {
    const header = cookieHeader(cookies);
    if (!/csrftoken=/.test(header)) {
      return { ok: false, error: missingError("Mistral", ["csrftoken"]) };
    }
    // The caller supplies the alias via a post-capture prompt; we default
    // to undefined here and the merge step assigns one if absent.
    return {
      ok: true,
      merge: (existing) => {
        const newAccount: Record<string, unknown> = { cookie: header };
        const existingAccounts = Array.isArray(existing?.accounts)
          ? (existing.accounts as unknown[])
          : null;
        // If the existing file is a legacy single-account shape, fold it in.
        if (existingAccounts === null && existing?.cookie !== undefined) {
          const legacy: Record<string, unknown> = { cookie: existing.cookie };
          if (typeof existing.alias === "string") legacy.alias = existing.alias;
          return { accounts: [legacy, newAccount] };
        }
        return {
          accounts: [...(existingAccounts ?? []), newAccount],
        };
      },
    };
  },
};

// (4) Ollama — ollama.com
// Plugin reads {cookie} with __Secure-session= (plugin/mystatus.ts:5549-5556).
const ollama: ProviderCaptureSpec = {
  id: "ollama",
  displayName: "Ollama Cloud",
  fileName: "ollama-cookies.json",
  portalUrl: "https://ollama.com",
  startUrl: "https://ollama.com",
  allowedOrigins: ["https://ollama.com"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["__Secure-session"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://ollama.com. The app captures your session " +
    "(including the __Secure-session cookie) and writes ollama-cookies.json.",
  extract: (cookies) => {
    const header = cookieHeader(cookies);
    if (!/__Secure-session=/.test(header)) {
      return { ok: false, error: missingError("Ollama", ["__Secure-session"]) };
    }
    return { ok: true, json: { cookie: header } };
  },
};

// (5) LongCat — longcat.chat
// Plugin reads {passportToken, region} OR {cookie} with both
// passport_token_key and long_cat_region_key (plugin/mystatus.ts:5704-5721).
// We write the structured form; region defaults to "2" when absent.
const longcat: ProviderCaptureSpec = {
  id: "longcat",
  displayName: "LongCat API",
  fileName: "longcat-cookies.json",
  portalUrl: "https://longcat.chat/platform/usage",
  startUrl: "https://longcat.chat/platform/usage",
  allowedOrigins: ["https://longcat.chat"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["passport_token_key"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://longcat.chat/platform/usage. The app captures your " +
    "session (passport_token_key + long_cat_region_key) and writes " +
    "longcat-cookies.json with {passportToken, region}.",
  extract: (cookies) => {
    const passport = cookieValue(cookies, "passport_token_key");
    if (!passport) {
      return { ok: false, error: missingError("LongCat", ["passport_token_key"]) };
    }
    const region = cookieValue(cookies, "long_cat_region_key") ?? "2";
    return { ok: true, json: { passportToken: passport, region } };
  },
};

// (6) QwenCloud — home.qwencloud.com
// Plugin reads {ticket, aliyunPk, isg, esmTicket?} from cookies
// login_qwencloud_ticket, login_aliyunid_pk, isg, optional
// login_ESM_account_ticket (plugin/mystatus.ts:4246-4332).
const qwencloud: ProviderCaptureSpec = {
  id: "qwencloud",
  displayName: "QwenCloud (Token Plan)",
  fileName: "qwencloud-cookies.json",
  portalUrl: "https://home.qwencloud.com",
  startUrl: "https://home.qwencloud.com",
  allowedOrigins: ["https://home.qwencloud.com", "https://cs-data.qwencloud.com"],
  idpOrigins: ["https://account.aliyun.com", "https://login.aliyun.com"],
  sentinelCookies: ["login_qwencloud_ticket"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://home.qwencloud.com. The app captures your session " +
    "(login_qwencloud_ticket, login_aliyunid_pk, isg, optional " +
    "login_ESM_account_ticket) and writes qwencloud-cookies.json.",
  extract: (cookies) => {
    const ticket = cookieValue(cookies, "login_qwencloud_ticket");
    const aliyunPk = cookieValue(cookies, "login_aliyunid_pk");
    const isg = cookieValue(cookies, "isg");
    const missing: string[] = [];
    if (!ticket) missing.push("login_qwencloud_ticket");
    if (!aliyunPk) missing.push("login_aliyunid_pk");
    if (!isg) missing.push("isg");
    if (missing.length > 0) {
      return { ok: false, error: missingError("QwenCloud", missing) };
    }
    const json: Record<string, unknown> = {
      ticket: ticket,
      aliyunPk: aliyunPk,
      isg: isg,
    };
    const esmTicket = cookieValue(cookies, "login_ESM_account_ticket");
    if (esmTicket) json.esmTicket = esmTicket;
    return { ok: true, json };
  },
};

// (7) StepFun — platform.stepfun.ai
// Plugin reads {oasisToken, oasisWebid, sessionToken?} from cookies
// Oasis-Token, Oasis-Webid, optional __Secure-next-auth.session-token
// (plugin/mystatus.ts:4025-4083).
const stepfun: ProviderCaptureSpec = {
  id: "stepfun",
  displayName: "StepFun (Step Plan)",
  fileName: "stepfun-cookies.json",
  portalUrl: "https://platform.stepfun.ai",
  startUrl: "https://platform.stepfun.ai",
  allowedOrigins: ["https://platform.stepfun.ai"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["Oasis-Token"],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://platform.stepfun.ai. The app captures your session " +
    "(Oasis-Token, Oasis-Webid, optional __Secure-next-auth.session-token) " +
    "and writes stepfun-cookies.json.",
  extract: (cookies) => {
    const oasisToken = cookieValue(cookies, "Oasis-Token");
    const oasisWebid = cookieValue(cookies, "Oasis-Webid");
    const missing: string[] = [];
    if (!oasisToken) missing.push("Oasis-Token");
    if (!oasisWebid) missing.push("Oasis-Webid");
    if (missing.length > 0) {
      return { ok: false, error: missingError("StepFun", missing) };
    }
    const json: Record<string, unknown> = { oasisToken, oasisWebid };
    const sessionToken = cookieValue(cookies, "__Secure-next-auth.session-token");
    if (sessionToken) json.sessionToken = sessionToken;
    return { ok: true, json };
  },
};

// (8) OpenCode Go+Zen — opencode.ai
// Multi-account: {accounts:[{id, workspaceId, authCookie}]}. workspaceId is
// parsed from the /workspace/<uuid> URL pattern (plugin/mystatus.ts:2373,
// 2393-2399, 2630-2667). The `auth` cookie is the sentinel.
const OPENCODE_GO_WS_PATTERN = /\/workspace\/([0-9a-fA-F-]{36})/;
const opencodeGo: ProviderCaptureSpec = {
  id: "opencode-go",
  displayName: "OpenCode Go+Zen",
  fileName: "opencode-go.json",
  portalUrl: "https://opencode.ai",
  startUrl: "https://opencode.ai",
  allowedOrigins: ["https://opencode.ai"],
  idpOrigins: [...COMMON_IDP_ORIGINS],
  sentinelCookies: ["auth"],
  urlPattern: OPENCODE_GO_WS_PATTERN,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  helpText:
    "Log into https://opencode.ai and open a workspace. The app captures " +
    "the auth cookie and parses the workspaceId from the /workspace/<uuid> " +
    "URL. Multiple workspaces merge into the accounts array in " +
    "opencode-go.json.",
  extract: (cookies, finalUrl) => {
    const authCookie = cookieValue(cookies, "auth");
    if (!authCookie) {
      return { ok: false, error: missingError("OpenCode Go", ["auth"]) };
    }
    let workspaceId: string | undefined;
    if (finalUrl !== undefined) {
      const m = finalUrl.match(OPENCODE_GO_WS_PATTERN);
      if (m) workspaceId = m[1];
    }
    if (!workspaceId) {
      return {
        ok: false,
        error:
          "OpenCode Go: could not parse workspaceId from the workspace URL. " +
          "Open a workspace (opencode.ai/workspace/<uuid>) and re-capture, " +
          "or enter the workspaceId manually.",
      };
    }
    const newAccount: Record<string, unknown> = { workspaceId, authCookie };
    return {
      ok: true,
      merge: (existing) => {
        const existingAccounts = Array.isArray(existing?.accounts)
          ? (existing.accounts as Array<Record<string, unknown>>)
          : [];
        // Merge by workspaceId: replace an existing entry with the same id,
        // otherwise append. The plugin's resolveOpenCodeGoConfigs reads the
        // accounts array and assigns id from index if absent.
        const filtered = existingAccounts.filter(
          (a) => a.workspaceId !== workspaceId,
        );
        return { accounts: [...filtered, newAccount] };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const COOKIE_PROVIDER_SPECS: readonly ProviderCaptureSpec[] = [
  atlascloud,
  byteplus,
  mistral,
  ollama,
  longcat,
  qwencloud,
  stepfun,
  opencodeGo,
];

const SPEC_BY_ID: ReadonlyMap<CookieProviderId, ProviderCaptureSpec> = new Map(
  COOKIE_PROVIDER_SPECS.map((s) => [s.id, s]),
);

/** Look up a spec by provider id. Returns `undefined` for non-cookie providers. */
export function getCaptureSpec(id: string): ProviderCaptureSpec | undefined {
  return SPEC_BY_ID.get(id as CookieProviderId);
}

/** All cookie-provider ids (for the Credentials page list). */
export function cookieProviderIds(): readonly CookieProviderId[] {
  return COOKIE_PROVIDER_SPECS.map((s) => s.id);
}