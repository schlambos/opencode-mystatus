import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureSpec } from "../shared/ipc.js";
import {
  captureWithSystemBrowser,
  findSystemBrowser,
  type CdpConn,
  type SystemBrowserDeps,
} from "./capture-system-browser.js";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

function makeSpec(over: Partial<CaptureSpec> = {}): CaptureSpec {
  return {
    partitionId: "mystatus-ollama",
    startUrl: "https://ollama.com/signin",
    allowedOrigins: ["https://ollama.com", "https://signin.ollama.com"],
    idpOrigins: ["https://accounts.google.com", "https://api.workos.com"],
    sentinelCookies: ["__Secure-session"],
    timeoutMs: 5_000,
    ...over,
  };
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((sig?: NodeJS.Signals) => {
    this.exitCode = sig === "SIGKILL" ? 1 : 0;
    this.emit("exit", this.exitCode, sig ?? null);
    return true;
  });
}

function makeDeps(opts: {
  browserPath?: string | null;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
  exitImmediately?: boolean;
  cdpFail?: boolean;
}): { deps: SystemBrowserDeps; child: FakeChild; cdpSend: ReturnType<typeof vi.fn> } {
  const child = new FakeChild();
  const cookieJar = [...(opts.cookies ?? [])];

  const cdpSend = vi.fn(async (method: string) => {
    if (method === "Target.setDiscoverTargets") return {};
    if (method === "Target.getTargets") {
      return {
        targetInfos: [{ targetId: "t1", type: "page", url: "https://ollama.com/signin" }],
      };
    }
    if (method === "Target.attachToTarget") return { sessionId: "sess-1" };
    if (method === "Network.enable" || method === "Page.enable" || method === "Page.bringToFront") {
      return {};
    }
    if (method === "Storage.getCookies") return { cookies: cookieJar };
    if (method === "Network.getCookies") return { cookies: cookieJar };
    return {};
  });

  const cdp: CdpConn = {
    send: cdpSend as CdpConn["send"],
    onEvent: vi.fn(),
    close: vi.fn(),
  };

  const deps: SystemBrowserDeps = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    findBrowser: () => (opts.browserPath === undefined ? "/fake/chrome" : opts.browserPath),
    freePort: async () => 9222,
    mkdtemp: () => "/tmp/mystatus-capture-test",
    rmrf: vi.fn(),
    spawnBrowser: (_exe, args) => {
      // Ensure we launch as an app window, not a full browser chrome UI.
      expect(args.some((a) => a.startsWith("--app="))).toBe(true);
      if (opts.exitImmediately) {
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit("exit", 0, null);
        });
      }
      return child as unknown as ChildProcess;
    },
    connectCdp: async () => {
      if (opts.cdpFail) throw new Error("cdp boom");
      return cdp;
    },
    waitForCdpEndpoint: async () => "ws://127.0.0.1:9222/devtools/browser/x",
  };

  return { deps, child, cdpSend };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findSystemBrowser", () => {
  it("returns null on linux with empty PATH", () => {
    expect(findSystemBrowser("linux", "")).toBeNull();
  });
});

describe("captureWithSystemBrowser", () => {
  it("returns null when no browser is installed", async () => {
    const { deps } = makeDeps({ browserPath: null });
    // spawnBrowser assert won't run
    const depsNoSpawn: SystemBrowserDeps = {
      ...deps,
      spawnBrowser: () => {
        throw new Error("should not spawn");
      },
    };
    const result = await captureWithSystemBrowser(makeSpec(), depsNoSpawn);
    expect(result).toBeNull();
  });

  it("returns ok with cookies when sentinel appears via Storage.getCookies", async () => {
    const { deps, child, cdpSend } = makeDeps({
      cookies: [{ name: "__Secure-session", value: "sess-abc", domain: "ollama.com" }],
    });
    const result = await captureWithSystemBrowser(makeSpec(), deps);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("ok");
    expect(result!.cookies.some((c) => c.name === "__Secure-session")).toBe(true);
    expect(result!.cookies.find((c) => c.name === "__Secure-session")?.value).toBe("sess-abc");
    expect(result!.detail).toMatch(/app window/i);
    expect(cdpSend).toHaveBeenCalledWith("Storage.getCookies", {});
    expect(child.kill).toHaveBeenCalled();
  });

  it("returns cancelled when the user closes the window", async () => {
    const { deps } = makeDeps({
      cookies: [],
      exitImmediately: true,
    });
    const result = await captureWithSystemBrowser(makeSpec({ timeoutMs: 10_000 }), deps);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("cancelled");
  });

  it("returns timeout when sentinel never appears", async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps({ cookies: [] });
    const promise = captureWithSystemBrowser(makeSpec({ timeoutMs: 1000 }), deps);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.status).toBe("timeout");
    vi.useRealTimers();
  });

  it("returns cancelled detail when CDP fails after launch", async () => {
    const { deps, child } = makeDeps({ cdpFail: true });
    const result = await captureWithSystemBrowser(makeSpec(), deps);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("cancelled");
    expect(result!.detail).toMatch(/failed/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it("never puts cookie values into detail strings", async () => {
    const secret = "super-secret-cookie-value-xyz";
    const { deps } = makeDeps({
      cookies: [{ name: "__Secure-session", value: secret }],
    });
    const result = await captureWithSystemBrowser(makeSpec(), deps);
    expect(result!.detail ?? "").not.toContain(secret);
  });
});
