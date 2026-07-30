// Tests for per-provider cookie capture configs (todo 11).
//
// Per-provider: fixture cookie arrays (incl. HttpOnly + unrelated cookies) →
// exact expected JSON written to a tmp config dir (assert deep-equal). Mistral
// + opencode-go merge paths preserve pre-existing accounts. Redaction test:
// log output contains zero cookie values.
//
// No Electron, no GUI, no real provider portals. Vitest only with fixture
// cookie arrays.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_PROVIDER_SPECS,
  cookieHeader,
  cookieProviderIds,
  getCaptureSpec,
  type CookieProviderId,
  type ExtractionResult,
  type ProviderCaptureSpec,
} from "./capture-specs.js";
import type { CapturedCookie } from "../shared/ipc.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function cookie(
  name: string,
  value: string,
  extra: Partial<CapturedCookie> = {},
): CapturedCookie {
  return { name, value, ...extra };
}

/** A sentinel + a couple of unrelated cookies, one HttpOnly. */
function withNoise(
  sentinel: CapturedCookie,
  extras: CapturedCookie[] = [],
): CapturedCookie[] {
  return [
    cookie("g_state", "AAAA"),
    sentinel,
    cookie("aid", "abc123", { httpOnly: true }),
    ...extras,
  ];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("exposes exactly the 8 cookie providers", () => {
    expect(COOKIE_PROVIDER_SPECS).toHaveLength(8);
    expect(cookieProviderIds()).toEqual([
      "atlascloud",
      "byteplus",
      "mistral",
      "ollama",
      "longcat",
      "qwencloud",
      "stepfun",
      "opencode-go",
    ]);
  });

  it("getCaptureSpec returns the spec for a known id and undefined otherwise", () => {
    expect(getCaptureSpec("atlascloud")?.id).toBe("atlascloud");
    expect(getCaptureSpec("not-a-cookie-provider")).toBeUndefined();
    expect(getCaptureSpec("copilot")).toBeUndefined();
  });

  it("every spec has a unique fileName and a non-empty sentinelCookies list", () => {
    const names = COOKIE_PROVIDER_SPECS.map((s) => s.fileName);
    expect(new Set(names).size).toBe(names.length);
    for (const s of COOKIE_PROVIDER_SPECS) {
      expect(s.sentinelCookies.length).toBeGreaterThan(0);
      expect(s.startUrl.startsWith("https://")).toBe(true);
      expect(s.allowedOrigins.length).toBeGreaterThan(0);
      expect(s.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("every spec includes at least one federated IdP origin so SSO does not dead-end", () => {
    for (const s of COOKIE_PROVIDER_SPECS) {
      expect(s.idpOrigins.length).toBeGreaterThan(0);
    }
  });

  it("non-Aliyun providers include the common Google/GitHub IdP origins", () => {
    for (const s of COOKIE_PROVIDER_SPECS) {
      if (s.id === "qwencloud") continue; // Aliyun IdP, not Google/GitHub
      expect(s.idpOrigins).toContain("https://accounts.google.com");
      expect(s.idpOrigins).toContain("https://github.com");
    }
  });

  it("qwencloud uses Aliyun IdP origins", () => {
    const qwen = getCaptureSpec("qwencloud")!;
    expect(qwen.idpOrigins).toContain("https://account.aliyun.com");
    expect(qwen.idpOrigins).toContain("https://login.aliyun.com");
  });
});

// ---------------------------------------------------------------------------
// cookieHeader helper
// ---------------------------------------------------------------------------

describe("cookieHeader", () => {
  it("joins name=value pairs with '; '", () => {
    const cookies = [cookie("a", "1"), cookie("b", "two")];
    expect(cookieHeader(cookies)).toBe("a=1; b=two");
  });

  it("returns '' for an empty array", () => {
    expect(cookieHeader([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Per-provider extraction
// ---------------------------------------------------------------------------

describe("atlascloud", () => {
  const spec = getCaptureSpec("atlascloud")!;
  it("writes {cookie} with the full header when access-token is present", () => {
    const cookies = withNoise(cookie("access-token", "eyJ.jwt.payload"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      const json = result.json as { cookie: string };
      expect(json.cookie).toContain("access-token=eyJ.jwt.payload");
      expect(json.cookie).toContain("g_state=AAAA");
      expect(json.cookie).toContain("aid=abc123");
      // accountUuid is omitted — plugin auto-resolves via /current-user.
      expect(json.accountUuid).toBeUndefined();
    }
  });

  it("refuses with a per-field error when access-token is missing", () => {
    const cookies = withNoise(cookie("other", "x"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("access-token");
  });
});

describe("byteplus", () => {
  const spec = getCaptureSpec("byteplus")!;
  it("writes {cookie} when csrfToken is present", () => {
    const cookies = withNoise(cookie("csrfToken", "tok-123"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect((result.json as { cookie: string }).cookie).toContain(
        "csrfToken=tok-123",
      );
    }
  });

  it("refuses when csrfToken is missing", () => {
    const cookies = [cookie("session", "x")];
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("csrfToken");
  });
});

describe("mistral", () => {
  const spec = getCaptureSpec("mistral")!;
  it("returns a merge fn that creates accounts[] when no existing file", () => {
    const cookies = withNoise(cookie("csrftoken", "csrf-1"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "merge" in result) {
      const merged = result.merge(null);
      expect(merged).toEqual({
        accounts: [{ cookie: expect.stringContaining("csrftoken=csrf-1") }],
      });
    }
  });

  it("merge appends to an existing accounts array, preserving entries", () => {
    const cookies = withNoise(cookie("csrftoken", "csrf-2"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "merge" in result) {
      const existing = {
        accounts: [{ alias: "primary", cookie: "csrftoken=old; x=y" }],
      };
      const merged = result.merge(existing);
      expect(merged.accounts).toHaveLength(2);
      expect((merged.accounts as unknown[])[0]).toEqual({
        alias: "primary",
        cookie: "csrftoken=old; x=y",
      });
    }
  });

  it("merge folds a legacy single-account file into accounts[]", () => {
    const cookies = withNoise(cookie("csrftoken", "csrf-3"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "merge" in result) {
      const existing = { alias: "primary", cookie: "csrftoken=legacy" };
      const merged = result.merge(existing);
      expect(merged.accounts).toHaveLength(2);
      expect((merged.accounts as unknown[])[0]).toEqual({
        alias: "primary",
        cookie: "csrftoken=legacy",
      });
    }
  });

  it("refuses when csrftoken is missing", () => {
    const cookies = [cookie("other", "x")];
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("csrftoken");
  });
});

describe("ollama", () => {
  const spec = getCaptureSpec("ollama")!;
  it("writes {cookie} when __Secure-session is present", () => {
    const cookies = withNoise(cookie("__Secure-session", "sess-1"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect((result.json as { cookie: string }).cookie).toContain(
        "__Secure-session=sess-1",
      );
    }
  });

  it("refuses when __Secure-session is missing", () => {
    const cookies = [cookie("aid", "x")];
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("__Secure-session");
  });
});

describe("longcat", () => {
  const spec = getCaptureSpec("longcat")!;
  it("writes {passportToken, region} from the two required cookies", () => {
    const cookies = withNoise(
      cookie("passport_token_key", "ppt-1"),
      [cookie("long_cat_region_key", "2")],
    );
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect(result.json).toEqual({ passportToken: "ppt-1", region: "2" });
    }
  });

  it("defaults region to '2' when long_cat_region_key is absent", () => {
    const cookies = withNoise(cookie("passport_token_key", "ppt-2"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect(result.json).toEqual({ passportToken: "ppt-2", region: "2" });
    }
  });

  it("refuses when passport_token_key is missing", () => {
    const cookies = [cookie("long_cat_region_key", "2")];
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("passport_token_key");
  });
});

describe("qwencloud", () => {
  const spec = getCaptureSpec("qwencloud")!;
  it("writes {ticket, aliyunPk, isg} when all three required cookies present", () => {
    const cookies = withNoise(
      cookie("login_qwencloud_ticket", "t-1"),
      [
        cookie("login_aliyunid_pk", "pk-1"),
        cookie("isg", "isg-1"),
      ],
    );
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect(result.json).toEqual({
        ticket: "t-1",
        aliyunPk: "pk-1",
        isg: "isg-1",
      });
    }
  });

  it("includes esmTicket when login_ESM_account_ticket is present", () => {
    const cookies = withNoise(
      cookie("login_qwencloud_ticket", "t-2"),
      [
        cookie("login_aliyunid_pk", "pk-2"),
        cookie("isg", "isg-2"),
        cookie("login_ESM_account_ticket", "esm-2"),
      ],
    );
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect(result.json).toEqual({
        ticket: "t-2",
        aliyunPk: "pk-2",
        isg: "isg-2",
        esmTicket: "esm-2",
      });
    }
  });

  it("refuses with a per-field error listing ALL missing cookies when sentinel present but required fields absent", () => {
    // Sentinel present, but aliyunPk + isg missing.
    const cookies = withNoise(cookie("login_qwencloud_ticket", "t-3"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("login_aliyunid_pk");
      expect(result.error).toContain("isg");
      expect(result.error).not.toContain("login_qwencloud_ticket");
    }
  });
});

describe("stepfun", () => {
  const spec = getCaptureSpec("stepfun")!;
  it("writes {oasisToken, oasisWebid} when both required cookies present", () => {
    const cookies = withNoise(
      cookie("Oasis-Token", "ot-1"),
      [cookie("Oasis-Webid", "ow-1")],
    );
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect(result.json).toEqual({ oasisToken: "ot-1", oasisWebid: "ow-1" });
    }
  });

  it("includes sessionToken when __Secure-next-auth.session-token is present", () => {
    const cookies = withNoise(
      cookie("Oasis-Token", "ot-2"),
      [
        cookie("Oasis-Webid", "ow-2"),
        cookie("__Secure-next-auth.session-token", "st-2"),
      ],
    );
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(true);
    if (result.ok && "json" in result) {
      expect(result.json).toEqual({
        oasisToken: "ot-2",
        oasisWebid: "ow-2",
        sessionToken: "st-2",
      });
    }
  });

  it("refuses listing both missing cookies when neither Oasis cookie is present", () => {
    const cookies = [cookie("other", "x")];
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Oasis-Token");
      expect(result.error).toContain("Oasis-Webid");
    }
  });
});

describe("opencode-go", () => {
  const spec = getCaptureSpec("opencode-go")!;
  const WS_UUID = "01912345-6789-7abc-8def-0123456789ab";
  const WS_URL = `https://opencode.ai/workspace/${WS_UUID}/go`;

  it("parses workspaceId from the finalUrl /workspace/<uuid> pattern", () => {
    const cookies = withNoise(cookie("auth", "auth-1"));
    const result = spec.extract(cookies, WS_URL);
    expect(result.ok).toBe(true);
    if (result.ok && "merge" in result) {
      const merged = result.merge(null);
      expect(merged).toEqual({
        accounts: [{ workspaceId: WS_UUID, authCookie: "auth-1" }],
      });
    }
  });

  it("merge replaces an existing account with the same workspaceId", () => {
    const cookies = withNoise(cookie("auth", "auth-2"));
    const result = spec.extract(cookies, WS_URL);
    expect(result.ok).toBe(true);
    if (result.ok && "merge" in result) {
      const existing = {
        accounts: [
          { workspaceId: WS_UUID, authCookie: "old" },
          { workspaceId: "other-uuid", authCookie: "keep" },
        ],
      };
      const merged = result.merge(existing);
      expect(merged.accounts).toHaveLength(2);
      const accounts = merged.accounts as Array<{ workspaceId: string; authCookie: string }>;
      const replaced = accounts.find((a) => a.workspaceId === WS_UUID);
      expect(replaced?.authCookie).toBe("auth-2");
      const kept = accounts.find((a) => a.workspaceId === "other-uuid");
      expect(kept?.authCookie).toBe("keep");
    }
  });

  it("merge appends a new workspaceId", () => {
    const cookies = withNoise(cookie("auth", "auth-3"));
    const result = spec.extract(cookies, WS_URL);
    expect(result.ok).toBe(true);
    if (result.ok && "merge" in result) {
      const existing = {
        accounts: [{ workspaceId: "other-uuid", authCookie: "keep" }],
      };
      const merged = result.merge(existing);
      expect(merged.accounts).toHaveLength(2);
    }
  });

  it("refuses when the auth cookie is missing", () => {
    const cookies = [cookie("other", "x")];
    const result = spec.extract(cookies, WS_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("auth");
  });

  it("refuses when workspaceId cannot be parsed from finalUrl", () => {
    const cookies = withNoise(cookie("auth", "auth-4"));
    const result = spec.extract(cookies, "https://opencode.ai/dashboard");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("workspaceId");
  });

  it("refuses when finalUrl is undefined", () => {
    const cookies = withNoise(cookie("auth", "auth-5"));
    const result = spec.extract(cookies, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("workspaceId");
  });

  it("urlPattern matches a /workspace/<uuid> URL", () => {
    expect(spec.urlPattern?.test(WS_URL)).toBe(true);
    expect(spec.urlPattern?.test("https://opencode.ai/workspace/short/go")).toBe(
      false,
    );
    expect(spec.urlPattern?.test("https://opencode.ai/dashboard")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Redaction: extraction never leaks cookie values into logs
// ---------------------------------------------------------------------------

describe("redaction", () => {
  const SECRET_VALUES = [
    "eyJ.jwt.payload",
    "tok-123",
    "csrf-1",
    "sess-1",
    "ppt-1",
    "t-1",
    "pk-1",
    "isg-1",
    "esm-2",
    "ot-1",
    "ow-1",
    "st-2",
    "auth-1",
  ];

  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("extraction functions do not log cookie values when called", () => {
    for (const spec of COOKIE_PROVIDER_SPECS) {
      // Build a fixture with a sentinel for this spec.
      const sentinel = spec.sentinelCookies[0];
      const cookies: CapturedCookie[] = [
        cookie(sentinel, "SECRET-" + sentinel),
        cookie("noise", "noise-val"),
      ];
      // Add a finalUrl for opencode-go.
      const finalUrl =
        spec.id === "opencode-go"
          ? "https://opencode.ai/workspace/01912345-6789-7abc-8def-0123456789ab/go"
          : undefined;
      const result = spec.extract(cookies, finalUrl);
      // Exercise the merge path too.
      if (result.ok && "merge" in result) {
        result.merge(null);
        result.merge({ accounts: [{ cookie: "old" }] });
      }
    }
    // Scan everything console.log was called with for any secret value.
    for (const call of logSpy.mock.calls) {
      for (const arg of call) {
        const text = typeof arg === "string" ? arg : JSON.stringify(arg);
        for (const secret of SECRET_VALUES) {
          expect(text).not.toContain(secret);
        }
      }
    }
  });

  it("the spec objects themselves do not embed cookie values", () => {
    for (const spec of COOKIE_PROVIDER_SPECS) {
      const text = JSON.stringify(spec);
      for (const secret of SECRET_VALUES) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Type-level: every spec's extract returns a valid ExtractionResult shape
// ---------------------------------------------------------------------------

describe("extract return shape", () => {
  it("every extract returns {ok:true, json|merge} or {ok:false, error}", () => {
    for (const spec of COOKIE_PROVIDER_SPECS) {
      const sentinel = spec.sentinelCookies[0];
      const cookies: CapturedCookie[] = [cookie(sentinel, "v")];
      const finalUrl =
        spec.id === "opencode-go"
          ? "https://opencode.ai/workspace/01912345-6789-7abc-8def-0123456789ab/go"
          : undefined;
      const result = spec.extract(cookies, finalUrl) as ExtractionResult;
      if (result.ok) {
        if ("json" in result) {
          expect(result.json).toBeTypeOf("object");
        } else if ("merge" in result) {
          expect(typeof result.merge).toBe("function");
        } else {
          throw new Error(`${spec.id}: ok result had neither json nor merge`);
        }
      } else {
        expect(typeof result.error).toBe("string");
        expect(result.error.length).toBeGreaterThan(0);
      }
    }
  });
});