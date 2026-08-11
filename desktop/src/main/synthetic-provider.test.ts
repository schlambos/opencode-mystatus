// Public-core integration coverage for the synthetic provider.
//
// The provider is deliberately exercised through coreApi.getViewModel rather
// than private parser helpers.  Each test owns a throwaway HOME/config dir and
// a fetch stub; no provider account, network, or developer config is touched.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MyStatusViewModel, ViewModelResult } from "../shared/ipc.js";

const TMP_HOME = mkdtempSync(join(tmpdir(), "mystatus-synthetic-provider-"));
const EXPLICIT_CONFIG_DIR = join(TMP_HOME, "explicit-config");
const XDG_DATA_HOME = join(TMP_HOME, "data");
const HOME_CONFIG_DIR = join(TMP_HOME, ".config", "opencode");

const ENV_NAMES = [
  "HOME",
  "USERPROFILE",
  "OPENCODE_CONFIG_DIR",
  "XDG_DATA_HOME",
  "SYNTHETIC_API_KEY",
] as const;

const savedEnv = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
) as Record<(typeof ENV_NAMES)[number], string | undefined>;

const ENV_KEY = "synthetic-env-credential";
const FILE_KEY = "synthetic-file-credential";
const SECRET_RESPONSE_BODY = "synthetic-response-secret";
const SYNTHETIC_QUOTAS_URL = "https://api.synthetic.new/v2/quotas";

type FetchCall = {
  url: string;
};

let coreApi: (typeof import("./core.js"))["coreApi"];
let fetchCalls: FetchCall[] = [];

beforeAll(async () => {
  process.env.HOME = TMP_HOME;
  process.env.USERPROFILE = TMP_HOME;
  process.env.OPENCODE_CONFIG_DIR = EXPLICIT_CONFIG_DIR;
  process.env.XDG_DATA_HOME = XDG_DATA_HOME;
  mkdirSync(HOME_CONFIG_DIR, { recursive: true });
  mkdirSync(EXPLICIT_CONFIG_DIR, { recursive: true });
  mkdirSync(join(XDG_DATA_HOME, "opencode"), { recursive: true });

  // core.ts is intentionally imported only after the filesystem environment
  // has been redirected; the plugin resolves homedir-dependent paths at load.
  ({ coreApi } = await import("./core.js"));
});

beforeEach(() => {
  fetchCalls = [];
  delete process.env.SYNTHETIC_API_KEY;
  resetFixtureFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFixtureFiles();
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_NAMES) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(TMP_HOME, { recursive: true, force: true });
});

function resetFixtureFiles(): void {
  rmSync(HOME_CONFIG_DIR, { recursive: true, force: true });
  rmSync(EXPLICIT_CONFIG_DIR, { recursive: true, force: true });
  rmSync(XDG_DATA_HOME, { recursive: true, force: true });
  mkdirSync(HOME_CONFIG_DIR, { recursive: true });
  mkdirSync(EXPLICIT_CONFIG_DIR, { recursive: true });
  mkdirSync(join(XDG_DATA_HOME, "opencode"), { recursive: true });
}

function seedConfig(config: Record<string, unknown>): void {
  const text = JSON.stringify(config);
  // loadConfig intentionally uses HOME while provider-specific files use the
  // explicit OPENCODE_CONFIG_DIR.
  writeFileSync(join(HOME_CONFIG_DIR, "mystatus.json"), text, "utf8");
}

function seedSyntheticApiKey(key: string): void {
  writeFileSync(
    join(EXPLICIT_CONFIG_DIR, "synthetic-api-key.json"),
    JSON.stringify({ apiKey: key }),
    "utf8",
  );
}

function seedAuthJsonKey(key: string): void {
  writeFileSync(
    join(XDG_DATA_HOME, "opencode", "auth.json"),
    JSON.stringify({ synthetic: { type: "api", key } }),
    "utf8",
  );
}

function syntheticConfig(): Record<string, unknown> {
  return { providers: { disabled: [] } };
}

function syntheticResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "synthetic-quota/v1",
    rollingFiveHourLimit: {
      remaining: 60,
      max: 100,
      tickPercent: 0.05,
      nextTickAt: "2030-01-02T03:04:05.000Z",
    },
    weeklyTokenLimit: {
      remainingCredits: "$176.00",
      maxCredits: "$200.00",
      percentRemaining: 88,
      nextRegenCredits: "$2.50",
      nextRegenAt: "2030-01-03T03:04:05.000Z",
    },
    ...overrides,
  };
}

function installFetch(
  body: unknown,
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const request = new Request(input, init);
      fetchCalls.push({ url: request.url });
      return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
    }),
  );
}

function installSourceSelectingFetch(
  envBody: unknown,
  configBody: unknown,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const request = new Request(input, init);
      const authorization = request.headers.get("authorization");
      fetchCalls.push({ url: request.url });
      // Make source precedence observable without exposing or asserting the
      // credential value in the test.
      const body = authorization?.endsWith(ENV_KEY) ? envBody : configBody;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function expectOneQuotaRequest(): void {
  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0]?.url).toBe(SYNTHETIC_QUOTAS_URL);
}

async function getResult(): Promise<ViewModelResult> {
  return coreApi.getViewModel({ only: "synthetic", format: "json", fresh: true });
}

function requireModel(result: ViewModelResult): MyStatusViewModel {
  if ("error" in result) throw new Error(result.error);
  return result;
}

function syntheticProvider(model: MyStatusViewModel): MyStatusViewModel["providers"][number] {
  const provider = model.providers.find((entry) => /synthetic/i.test(entry.name));
  if (!provider) throw new Error("synthetic provider did not render");
  return provider;
}

describe.sequential("synthetic provider public contracts", () => {
  it("prefers the OpenCode auth.json key over env and file credentials", async () => {
    seedConfig(syntheticConfig());
    seedSyntheticApiKey(FILE_KEY);
    seedAuthJsonKey("synthetic-auth-json-credential");
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installSourceSelectingFetch(
      syntheticResponse({
        rollingFiveHourLimit: { remaining: 91, max: 100 },
      }),
      syntheticResponse({
        rollingFiveHourLimit: { remaining: 21, max: 100 },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.find((window) => /rolling/i.test(window.label))?.remaining).toBe(21);
    expectOneQuotaRequest();
  });

  it("prefers the environment key over the configured key", async () => {
    seedConfig(syntheticConfig());
    seedSyntheticApiKey(FILE_KEY);
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installSourceSelectingFetch(
      syntheticResponse({
        rollingFiveHourLimit: { remaining: 91, max: 100 },
      }),
      syntheticResponse({
        rollingFiveHourLimit: { remaining: 21, max: 100 },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.find((window) => /rolling/i.test(window.label))?.remaining).toBe(91);
    expectOneQuotaRequest();
  });

  it("uses the key file when the environment key is absent", async () => {
    seedConfig(syntheticConfig());
    seedSyntheticApiKey(FILE_KEY);
    installFetch(syntheticResponse());

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.some((window) => /rolling/i.test(window.label))).toBe(true);
    expectOneQuotaRequest();
  });

  it("skips without making a request when credentials are absent", async () => {
    seedConfig({ providers: { disabled: [] } });
    installFetch(syntheticResponse());

    const result = await getResult();

    expect(fetchCalls).toHaveLength(0);
    expect("error" in result || result.providers.length === 0).toBe(true);
  });

  it("renders exactly finite rolling and weekly windows", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(syntheticResponse());

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.name).toBe("Synthetic");
    expect(provider.windows).toHaveLength(2);
    expect(provider.windows.some((window) => /rolling/i.test(window.label))).toBe(true);
    expect(provider.windows.some((window) => /weekly/i.test(window.label))).toBe(true);
    for (const window of provider.windows) {
      expect(Number.isFinite(window.remaining)).toBe(true);
      if (window.resetMs !== undefined) expect(Number.isFinite(window.resetMs)).toBe(true);
    }
    expectOneQuotaRequest();
  });

  it("uses percentRemaining before deriving a percentage from used and max", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        weeklyTokenLimit: {
          remainingCredits: "$3.00",
          maxCredits: "$10.00",
          percentRemaining: 73,
        },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.find((window) => /weekly/i.test(window.label))?.remaining).toBe(73);
    expectOneQuotaRequest();
  });

  it("falls back to the dollar remaining/limit ratio when no percentage is supplied", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        weeklyTokenLimit: {
          remainingCredits: "$3.00",
          maxCredits: "$10.00",
        },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.find((window) => /weekly/i.test(window.label))?.remaining).toBe(30);
    expectOneQuotaRequest();
  });

  it("does not parse numeric weekly dollar fields", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        weeklyTokenLimit: { remainingCredits: 3, maxCredits: 10 },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.some((window) => /weekly/i.test(window.label))).toBe(false);
    expect(provider.windows).toHaveLength(1);
    expectOneQuotaRequest();
  });

  it("does not derive a weekly ratio from a zero dollar maximum", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        weeklyTokenLimit: { remainingCredits: "$0.00", maxCredits: "$0.00" },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.some((window) => /weekly/i.test(window.label))).toBe(false);
    expect(provider.windows).toHaveLength(1);
    expectOneQuotaRequest();
  });

  it("does not add a subscription window beside a valid rolling window", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        subscription: { limit: 100, requests: 88, renewsAt: "2030-01-04T05:06:07.000Z" },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.filter((window) => /subscription/i.test(window.label))).toHaveLength(0);
    expect(provider.windows.some((window) => /rolling/i.test(window.label))).toBe(true);
    expectOneQuotaRequest();
  });

  it("uses the subscription window when rolling data is unavailable", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    const response = syntheticResponse({
      subscription: { limit: 100, requests: 88, renewsAt: "2030-01-04T05:06:07.000Z" },
    });
    delete response.rollingFiveHourLimit;
    installFetch(response);

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.some((window) => /subscription/i.test(window.label))).toBe(true);
    expect(provider.windows.find((window) => /subscription/i.test(window.label))?.remaining).toBe(12);
    expectOneQuotaRequest();
  });

  it("falls back to subscription when the rolling window is malformed", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        rollingFiveHourLimit: { remaining: "unknown", max: 100 },
        subscription: { limit: 100, requests: 88, renewsAt: "2030-01-04T05:06:07.000Z" },
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows.some((window) => /rolling/i.test(window.label))).toBe(false);
    expect(provider.windows.some((window) => /subscription/i.test(window.label))).toBe(true);
    expect(provider.windows.find((window) => /subscription/i.test(window.label))?.remaining).toBe(12);
    expectOneQuotaRequest();
  });

  it.each([
    { label: "zero", rolling: { remaining: 0, max: 0 } },
    { label: "missing", rolling: { remaining: 0 } },
  ])("omits a $label rolling maximum and falls back safely", async ({ rolling }) => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        rollingFiveHourLimit: rolling,
        subscription: { limit: 100, requests: 88, renewsAt: "2030-01-04T05:06:07.000Z" },
      }),
    );

    const result = await getResult();
    const provider = syntheticProvider(requireModel(result));
    expect(JSON.stringify(result)).not.toContain("NaN");
    expect(provider.windows.some((window) => /rolling/i.test(window.label))).toBe(false);
    expect(provider.windows.some((window) => /subscription/i.test(window.label))).toBe(true);
    expect(provider.windows.every((window) => Number.isFinite(window.remaining))).toBe(true);
    expectOneQuotaRequest();
  });

  it.each([
    { requests: -10, remaining: 100 },
    { requests: 150, remaining: 0 },
  ])("clamps subscription requests at the limit boundaries", async ({ requests, remaining }) => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    const response = syntheticResponse({
      subscription: { limit: 100, requests, renewsAt: "2030-01-04T05:06:07.000Z" },
    });
    delete response.rollingFiveHourLimit;
    delete response.weeklyTokenLimit;
    installFetch(response);

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows).toHaveLength(1);
    expect(provider.windows[0]?.remaining).toBe(remaining);
    expectOneQuotaRequest();
  });

  it("omits malformed undocumented components while valid quota windows render", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        components: [
          { name: "valid component", remaining: 64, max: 100 },
          { name: "malformed component", remaining: "unknown", max: null },
        ],
      }),
    );

    const provider = syntheticProvider(requireModel(await getResult()));
    expect(provider.windows).toHaveLength(2);
    expect(provider.windows.some((window) => /rolling/i.test(window.label))).toBe(true);
    expect(provider.windows.some((window) => /weekly/i.test(window.label))).toBe(true);
    expect(provider.windows.some((window) => /component/i.test(window.label))).toBe(false);
    expectOneQuotaRequest();
  });

  it("returns a provider error for an unrecognized response schema", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch({ schema: "not-a-supported-schema", data: { value: 1 } });

    const result = await getResult();

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/schema|synthetic|quota/i);
    expectOneQuotaRequest();
  });

  it("surfaces a limited warning with the calculated remaining percentage", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(
      syntheticResponse({
        rollingFiveHourLimit: { remaining: 20, max: 100, limited: true },
      }),
    );

    const exportResult = await coreApi.getAnsiExport({ only: "synthetic", format: "ansi", fresh: true });
    expect(exportResult.text).toMatch(/Limited/i);
    expect(exportResult.text).toContain("20% remaining");
    expectOneQuotaRequest();
  });

  it("renders regeneration timestamps without generic reset wording", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch(syntheticResponse());

    const exportResult = await coreApi.getJsonExport({ only: "synthetic", format: "json", fresh: true });

    expect(exportResult.text).toContain("Next regeneration: 2030-01-02T03:04:05.000Z");
    expect(exportResult.text).toContain("Next regeneration: 2030-01-03T03:04:05.000Z");
    expect(exportResult.text).not.toMatch(/reset/i);
    expectOneQuotaRequest();
  });

  it("renders subscription renewal separately from regeneration", async () => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    const response = syntheticResponse({
      subscription: { limit: 100, requests: 88, renewsAt: "2030-01-04T05:06:07.000Z" },
    });
    delete response.rollingFiveHourLimit;
    delete response.weeklyTokenLimit;
    installFetch(response);

    const exportResult = await coreApi.getJsonExport({ only: "synthetic", format: "json", fresh: true });

    expect(exportResult.text).toContain("Renewal: 2030-01-04T05:06:07.000Z");
    expect(exportResult.text).not.toContain("Regeneration: tick");
    expect(exportResult.text).not.toMatch(/reset/i);
    expectOneQuotaRequest();
  });

  it.each([400, 401, 403, 404])("does not include the response body or credential in a %s error", async (status) => {
    seedConfig(syntheticConfig());
    process.env.SYNTHETIC_API_KEY = ENV_KEY;
    installFetch({ error: SECRET_RESPONSE_BODY }, status);

    const result = await getResult();
    const publicText = JSON.stringify(result);

    expect(publicText).not.toContain(SECRET_RESPONSE_BODY);
    expect(publicText).not.toContain(ENV_KEY);
    if ("error" in result) {
      expect(result.error).toContain(`Synthetic quotas API error (${status})`);
    } else {
      expect(result.errors).toContain(`Synthetic quotas API error (${status})`);
    }
    expectOneQuotaRequest();
  });
});
