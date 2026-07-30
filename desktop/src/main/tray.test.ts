// Tests for the system tray (todo 16).
//
// vi.mock('electron') replaces Tray, Menu, nativeImage, app, BrowserWindow
// with recording stubs so we can assert icon variants, menu template, click
// behavior, and poller wiring without booting Electron or constructing a
// real tray. No GUI, no Playwright.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMenuTemplate,
  statusForModel,
  trayIconPath,
  TrayManager,
  type TrayDeps,
} from "./tray.js";
import type { MyStatusViewModel, PushPayload, ViewModelResult } from "../shared/ipc.js";

interface FakeWindow {
  isVisible: () => boolean;
  isFocused: () => boolean;
  isMinimized: () => boolean;
  show: () => void;
  hide: () => void;
  restore: () => void;
  focus: () => void;
}

function makeWindow(opts: Partial<FakeWindow> = {}): FakeWindow {
  return {
    isVisible: () => opts.isVisible?.() ?? true,
    isFocused: () => opts.isFocused?.() ?? true,
    isMinimized: () => opts.isMinimized?.() ?? false,
    show: opts.show ?? vi.fn(),
    hide: opts.hide ?? vi.fn(),
    restore: opts.restore ?? vi.fn(),
    focus: opts.focus ?? vi.fn(),
  };
}

function makeModel(overrides: Partial<MyStatusViewModel> = {}): MyStatusViewModel {
  return {
    summary: { accounts: 1, green: 1, yellow: 0, red: 0 },
    providers: [{ name: "Test", minRemaining: 100, windows: [{ label: "Session", remaining: 100 }] }],
    errors: [],
    alerts: [],
    threshold: 25,
    issues: [],
    health: { queried: 1, rendered: 1, stale: 0, failed: 0, unconfigured: 0 },
    ...overrides,
  };
}

describe("statusForModel", () => {
  it("returns gray for an error model", () => {
    expect(statusForModel({ error: "boom" })).toBe("gray");
  });

  it("returns gray when no providers reported", () => {
    expect(statusForModel(makeModel({ providers: [] }))).toBe("gray");
  });

  it("returns red when any provider is at or below 0", () => {
    const m = makeModel({
      providers: [
        { name: "A", minRemaining: 100, windows: [{ label: "x", remaining: 100 }] },
        { name: "B", minRemaining: 0, windows: [{ label: "x", remaining: 0 }] },
      ],
    });
    expect(statusForModel(m)).toBe("red");
  });

  it("returns red when any provider is below threshold", () => {
    const m = makeModel({
      threshold: 25,
      providers: [
        { name: "A", minRemaining: 100, windows: [{ label: "x", remaining: 100 }] },
        { name: "B", minRemaining: 10, windows: [{ label: "x", remaining: 10 }] },
      ],
    });
    expect(statusForModel(m)).toBe("red");
  });

  it("returns yellow when a provider is below 50 but at/above threshold", () => {
    const m = makeModel({
      threshold: 25,
      providers: [
        { name: "A", minRemaining: 100, windows: [{ label: "x", remaining: 100 }] },
        { name: "B", minRemaining: 40, windows: [{ label: "x", remaining: 40 }] },
      ],
    });
    expect(statusForModel(m)).toBe("yellow");
  });

  it("returns green when all providers are at or above 50", () => {
    const m = makeModel({
      threshold: 25,
      providers: [
        { name: "A", minRemaining: 80, windows: [{ label: "x", remaining: 80 }] },
        { name: "B", minRemaining: 60, windows: [{ label: "x", remaining: 60 }] },
      ],
    });
    expect(statusForModel(m)).toBe("green");
  });

  it("treats threshold boundary (exactly threshold) as not red", () => {
    const m = makeModel({
      threshold: 25,
      providers: [{ name: "A", minRemaining: 25, windows: [{ label: "x", remaining: 25 }] }],
    });
    expect(statusForModel(m)).toBe("yellow");
  });
});

describe("trayIconPath", () => {
  it("maps each status to its icon file", () => {
    const dir = "/icons";
    expect(trayIconPath("green", dir)).toBe("/icons/tray-green.png");
    expect(trayIconPath("yellow", dir)).toBe("/icons/tray-yellow.png");
    expect(trayIconPath("red", dir)).toBe("/icons/tray-red.png");
    expect(trayIconPath("gray", dir)).toBe("/icons/tray-gray.png");
  });
});

describe("buildMenuTemplate", () => {
  function makeDeps(): TrayDeps {
    return {
      getWindows: () => [],
      createWindow: vi.fn(),
      refresh: vi.fn(),
      quit: vi.fn(),
      iconDir: "/icons",
    };
  }

  it("shows 'Show Dashboard' when no window is visible", () => {
    const tpl = buildMenuTemplate(
      { status: "green", issueCount: 0, windowVisible: false },
      makeDeps(),
    );
    expect(tpl[0]?.label).toBe("Show Dashboard");
  });

  it("shows 'Hide Dashboard' when a window is visible", () => {
    const tpl = buildMenuTemplate(
      { status: "green", issueCount: 0, windowVisible: true },
      makeDeps(),
    );
    expect(tpl[0]?.label).toBe("Hide Dashboard");
  });

  it("shows issue count in the Issues label when non-zero", () => {
    const tpl = buildMenuTemplate(
      { status: "red", issueCount: 3, windowVisible: false },
      makeDeps(),
    );
    const issuesItem = tpl.find((t) => t.label?.startsWith("Issues"));
    expect(issuesItem?.label).toBe("Issues (3)");
    expect(issuesItem?.enabled).toBe(true);
  });

  it("disables Issues when zero issues", () => {
    const tpl = buildMenuTemplate(
      { status: "green", issueCount: 0, windowVisible: false },
      makeDeps(),
    );
    const issuesItem = tpl.find((t) => t.label?.startsWith("Issues"));
    expect(issuesItem?.label).toBe("Issues");
    expect(issuesItem?.enabled).toBe(false);
  });

  it("includes a Quit item that calls deps.quit", () => {
    const deps = makeDeps();
    const tpl = buildMenuTemplate(
      { status: "green", issueCount: 0, windowVisible: false },
      deps,
    );
    const quit = tpl.find((t) => t.label === "Quit");
    expect(quit).toBeDefined();
    quit?.click?.(undefined as never, undefined as never, undefined as never);
    expect(deps.quit).toHaveBeenCalled();
  });

  it("Refresh Now click calls deps.refresh", () => {
    const deps = makeDeps();
    const tpl = buildMenuTemplate(
      { status: "green", issueCount: 0, windowVisible: false },
      deps,
    );
    const refresh = tpl.find((t) => t.label === "Refresh Now");
    refresh?.click?.(undefined as never, undefined as never, undefined as never);
    expect(deps.refresh).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TrayManager with mocked electron
// ---------------------------------------------------------------------------

vi.mock("electron", () => {
  const createdImages: { path: string }[] = [];
  const nativeImage = {
    createFromPath: (path: string) => {
      createdImages.push({ path });
      return { path };
    },
    _created: createdImages,
  };
  const trays: TrayStub[] = [];
  class TrayStub {
    image: unknown;
    tooltip = "";
    clickHandler: (() => void) | null = null;
    menu: unknown = null;
    destroyed = false;
    setImageCalls: { path: string }[] = [];
    setContextMenuCalls = 0;
    constructor(image: unknown) {
      this.image = image;
      trays.push(this);
    }
    setToolTip(tip: string) {
      this.tooltip = tip;
    }
    on(_event: string, cb: () => void) {
      this.clickHandler = cb;
    }
    setImage(path: string) {
      this.setImageCalls.push({ path });
      this.image = { path };
    }
    setContextMenu(menu: unknown) {
      this.menu = menu;
      this.setContextMenuCalls += 1;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const Menu = {
    buildFromTemplate: (tpl: Electron.MenuItemConstructorOptions[]) => ({ tpl }),
  };
  const app = {
    isPackaged: false,
    quit: vi.fn(),
  };
  const BrowserWindow = {};
  return { nativeImage, Tray: TrayStub, Menu, app, BrowserWindow, __trays: trays, __images: createdImages };
});

interface TrayStub {
  image: unknown;
  tooltip: string;
  clickHandler: (() => void) | null;
  menu: unknown;
  destroyed: boolean;
  setImageCalls: { path: string }[];
  setContextMenuCalls: number;
}

describe("TrayManager", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const electron = await import("electron") as unknown as {
      __trays: TrayStub[];
      __images: { path: string }[];
    };
    electron.__trays.length = 0;
    electron.__images.length = 0;
  });

  function makeDeps(windows: FakeWindow[] = []): TrayDeps {
    return {
      getWindows: () => windows as unknown as import("electron").BrowserWindow[],
      createWindow: vi.fn(),
      refresh: vi.fn(),
      quit: vi.fn(),
      iconDir: "/icons",
    };
  }

  it("creates a tray with the gray icon and subscribes to poll updates", async () => {
    const deps = makeDeps();
    const mgr = new TrayManager(deps);
    let subscribed = false;
    mgr.start((cb) => {
      subscribed = true;
      // immediately exercise the subscription path is the caller's job
      void cb;
      return () => {};
    });
    expect(subscribed).toBe(true);
    const electron = await import("electron") as unknown as {
      __trays: { image: { path: string }; tooltip: string; setContextMenuCalls: number }[];
      __images: { path: string }[];
    };
    expect(electron.__trays).toHaveLength(1);
    expect(electron.__trays[0]?.image.path).toBe("/icons/tray-gray.png");
    expect(electron.__trays[0]?.tooltip).toBe("mystatus");
    expect(electron.__trays[0]?.setContextMenuCalls).toBe(1);
    mgr.destroy();
  });

  it("left-click toggles the window (hides when visible+focused)", async () => {
    const win = makeWindow({ isVisible: () => true, isFocused: () => true, hide: vi.fn() });
    const deps = makeDeps([win]);
    const mgr = new TrayManager(deps);
    mgr.start(() => () => {});
    const electron = await import("electron") as unknown as {
      __trays: { clickHandler: (() => void) | null }[];
    };
    electron.__trays[0]?.clickHandler?.();
    expect(win.hide).toHaveBeenCalled();
    mgr.destroy();
  });

  it("left-click shows+focuses when window is hidden", async () => {
    const win = makeWindow({ isVisible: () => false, show: vi.fn(), focus: vi.fn() });
    const deps = makeDeps([win]);
    const mgr = new TrayManager(deps);
    mgr.start(() => () => {});
    const electron = await import("electron") as unknown as {
      __trays: { clickHandler: (() => void) | null }[];
    };
    electron.__trays[0]?.clickHandler?.();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    mgr.destroy();
  });

  it("left-click creates a window when none exist", async () => {
    const createWindow = vi.fn();
    const deps: TrayDeps = {
      getWindows: () => [],
      createWindow,
      refresh: vi.fn(),
      quit: vi.fn(),
      iconDir: "/icons",
    };
    const mgr = new TrayManager(deps);
    mgr.start(() => () => {});
    const electron = await import("electron") as unknown as {
      __trays: { clickHandler: (() => void) | null }[];
    };
    electron.__trays[0]?.clickHandler?.();
    expect(createWindow).toHaveBeenCalled();
    mgr.destroy();
  });

  it("updates icon and menu when a poll changes status", async () => {
    const deps = makeDeps();
    const mgr = new TrayManager(deps);
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    const electron = await import("electron") as unknown as {
      __trays: { setImageCalls: { path: string }[]; setContextMenuCalls: number }[];
    };
    const tray = electron.__trays[0];
    expect(tray?.setImageCalls).toHaveLength(0);
    expect(tray?.setContextMenuCalls).toBe(1);

    // Push a red model.
    pollCb?.({
      model: makeModel({
        threshold: 25,
        providers: [{ name: "A", minRemaining: 5, windows: [{ label: "x", remaining: 5 }] }],
        issues: [{ provider: "A", kind: "error", detail: "down" }],
      }),
      fetchedAt: 0,
      nextFetchAt: 0,
    });
    expect(tray?.setImageCalls).toHaveLength(1);
    expect(tray?.setImageCalls[0]?.path).toBe("/icons/tray-red.png");
    expect(tray?.setContextMenuCalls).toBe(2);

    // Push the same status again — no setImage call (dedup).
    pollCb?.({
      model: makeModel({
        threshold: 25,
        providers: [{ name: "A", minRemaining: 5, windows: [{ label: "x", remaining: 5 }] }],
        issues: [{ provider: "A", kind: "error", detail: "down" }],
      }),
      fetchedAt: 0,
      nextFetchAt: 0,
    });
    expect(tray?.setImageCalls).toHaveLength(1);
    expect(tray?.setContextMenuCalls).toBe(2);

    // Push a green model — icon updates.
    pollCb?.({
      model: makeModel({ threshold: 25 }),
      fetchedAt: 0,
      nextFetchAt: 0,
    });
    expect(tray?.setImageCalls).toHaveLength(2);
    expect(tray?.setImageCalls[1]?.path).toBe("/icons/tray-green.png");

    mgr.destroy();
  });

  it("destroy unsubscribes and destroys the tray", async () => {
    const deps = makeDeps();
    const mgr = new TrayManager(deps);
    let unsubscribed = false;
    mgr.start(() => () => {
      unsubscribed = true;
      return () => {};
    });
    mgr.destroy();
    expect(unsubscribed).toBe(true);
    const electron = await import("electron") as unknown as {
      __trays: { destroyed: boolean }[];
    };
    expect(electron.__trays[0]?.destroyed).toBe(true);
  });

  it("start is idempotent", () => {
    const deps = makeDeps();
    const mgr = new TrayManager(deps);
    let subCount = 0;
    const start = () => {
      subCount += 1;
      return () => {};
    };
    mgr.start(start);
    mgr.start(start);
    expect(subCount).toBe(1);
    mgr.destroy();
  });

  it("handles error model payloads as gray without throwing", async () => {
    const deps = makeDeps();
    const mgr = new TrayManager(deps);
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    const electron = await import("electron") as unknown as {
      __trays: TrayStub[];
    };
    // Initial tray is gray; an error model is also gray, so no setImage
    // call fires (dedup). The point of this test is that the error payload
    // does not throw.
    expect(() => {
      pollCb?.({ model: { error: "fail" }, fetchedAt: 0, nextFetchAt: 0 });
    }).not.toThrow();
    expect(electron.__trays[0]?.setImageCalls).toHaveLength(0);
    mgr.destroy();
  });
});