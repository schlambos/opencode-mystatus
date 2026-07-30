// Tests for threshold-crossing notifications (todo 17).
//
// Two layers:
//   1. `decideNotifications` — pure decision function, no Electron. Covers
//      baseline, crossing, recovery, cooldown, suppression, error model.
//   2. `NotifierManager` — owns state, fires Electron `Notification`. Tested
//      with a recording stub factory (no real Electron Notification).
//
// No GUI, no Playwright. vi.mock('electron') replaces `Notification` so the
// module imports cleanly under VITEST.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideNotifications,
  NotifierManager,
  suppressedFromConfig,
  type DecideInput,
  type KeyState,
  type NotifierState,
  type PendingNotification,
} from "./notifier.js";
import type {
  DesktopPrefs,
  MyStatusConfig,
  MyStatusViewModel,
  PushPayload,
} from "../shared/ipc.js";

// notifier.ts imports `Notification` from electron at module load. Electron is
// installed (dev dep) so the import resolves under VITEST; `Notification` is
// undefined outside the Electron runtime, which is fine — the pure decision
// tests never call it, and the NotifierManager tests inject their own
// recording factory so the real constructor is never reached.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THRESHOLD = 25;
const COOLDOWN_MS = 60 * 60_000; // 60 min

function makeModel(overrides: Partial<MyStatusViewModel> = {}): MyStatusViewModel {
  return {
    summary: { accounts: 1, green: 1, yellow: 0, red: 0 },
    providers: [{ name: "Test", minRemaining: 100, windows: [{ label: "Session", remaining: 100 }] }],
    errors: [],
    alerts: [],
    threshold: THRESHOLD,
    issues: [],
    health: { queried: 1, rendered: 1, stale: 0, failed: 0, unconfigured: 0 },
    ...overrides,
  };
}

function makeInput(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    prev: new Map<string, KeyState>(),
    model: makeModel(),
    threshold: THRESHOLD,
    cooldownMs: COOLDOWN_MS,
    suppressed: new Set<string>(),
    now: 1_000_000,
    isBaseline: false,
    ...overrides,
  };
}

function names(result: { notifications: readonly PendingNotification[] }): string[] {
  return result.notifications.map((n) => `${n.provider}::${n.windowLabel}:${n.kind}`);
}

// ---------------------------------------------------------------------------
// decideNotifications — pure decision
// ---------------------------------------------------------------------------

describe("decideNotifications — baseline", () => {
  it("fires nothing on the baseline poll and seeds state", () => {
    const model = makeModel({
      providers: [
        { name: "A", minRemaining: 10, windows: [{ label: "5h", remaining: 10 }] },
        { name: "B", minRemaining: 80, windows: [{ label: "Weekly", remaining: 80 }] },
      ],
    });
    const r = decideNotifications(makeInput({ model, isBaseline: true }));
    expect(r.notifications).toHaveLength(0);
    expect(r.next.get("A::5h")?.remaining).toBe(10);
    expect(r.next.get("B::Weekly")?.remaining).toBe(80);
  });

  it("treats the first observation of a new key as baseline (no notification)", () => {
    // State is empty; even with isBaseline=false, a brand-new key is seeded,
    // not notified.
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 10, windows: [{ label: "5h", remaining: 10 }] }],
    });
    const r = decideNotifications(makeInput({ model, isBaseline: false }));
    expect(r.notifications).toHaveLength(0);
    expect(r.next.get("A::5h")?.remaining).toBe(10);
  });
});

describe("decideNotifications — crossing", () => {
  it("fires one crossed notification on a down-edge", () => {
    const prev: NotifierState = new Map([["A::5h", { remaining: 30, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model }));
    expect(names(r)).toEqual(["A::5h:crossed"]);
    expect(r.next.get("A::5h")?.lastNotifiedAt).toBe(1_000_000);
  });

  it("does not fire when remaining stays below threshold (no edge)", () => {
    const prev: NotifierState = new Map([["A::5h", { remaining: 20, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 15, windows: [{ label: "5h", remaining: 15 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model }));
    expect(r.notifications).toHaveLength(0);
    expect(r.next.get("A::5h")?.remaining).toBe(15);
  });

  it("does not fire when remaining stays above threshold (no edge)", () => {
    const prev: NotifierState = new Map([["A::5h", { remaining: 30, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 28, windows: [{ label: "5h", remaining: 28 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model }));
    expect(r.notifications).toHaveLength(0);
  });

  it("treats the threshold boundary as not-below (25 is yellow, not red)", () => {
    // Mirrors plugin/mystatus.ts:7346 (min >= threshold => yellow).
    const prev: NotifierState = new Map([["A::5h", { remaining: 20, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 25, windows: [{ label: "5h", remaining: 25 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model }));
    // 20 -> 25 is a recovery (was below, now at threshold = not below).
    expect(names(r)).toEqual(["A::5h:recovered"]);
  });
});

describe("decideNotifications — recovery", () => {
  it("fires one recovered notification on an up-edge", () => {
    const prev: NotifierState = new Map([["A::5h", { remaining: 20, lastNotifiedAt: 500_000 }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 40, windows: [{ label: "5h", remaining: 40 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model }));
    expect(names(r)).toEqual(["A::5h:recovered"]);
    // Recovery does not touch lastNotifiedAt.
    expect(r.next.get("A::5h")?.lastNotifiedAt).toBe(500_000);
  });
});

describe("decideNotifications — cooldown", () => {
  it("suppresses a crossed notification inside the cooldown window", () => {
    const lastNotifiedAt = 950_000; // 50_000 ms ago, < 60min cooldown
    const prev: NotifierState = new Map([
      ["A::5h", { remaining: 30, lastNotifiedAt }],
    ]);
    // 30 -> 20 is a crossing, but we're in cooldown.
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model, now: 1_000_000 }));
    expect(r.notifications).toHaveLength(0);
    // State still updates; lastNotifiedAt is preserved (still in cooldown).
    expect(r.next.get("A::5h")?.remaining).toBe(20);
    expect(r.next.get("A::5h")?.lastNotifiedAt).toBe(lastNotifiedAt);
  });

  it("fires a crossed notification after the cooldown expires", () => {
    const lastNotifiedAt = 100_000; // 4,900,000 ms ago, > 60min cooldown (3,600,000)
    const prev: NotifierState = new Map([
      ["A::5h", { remaining: 30, lastNotifiedAt }],
    ]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model, now: 5_000_000 }));
    expect(names(r)).toEqual(["A::5h:crossed"]);
    expect(r.next.get("A::5h")?.lastNotifiedAt).toBe(5_000_000);
  });

  it("recovery is NOT cooldown-gated", () => {
    const lastNotifiedAt = 999_999; // just fired, deep in cooldown
    const prev: NotifierState = new Map([
      ["A::5h", { remaining: 20, lastNotifiedAt }],
    ]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 40, windows: [{ label: "5h", remaining: 40 }] }],
    });
    const r = decideNotifications(makeInput({ prev, model, now: 1_000_000 }));
    expect(names(r)).toEqual(["A::5h:recovered"]);
  });
});

describe("decideNotifications — suppression", () => {
  it("suppresses notifications for hidden providers", () => {
    const prev: NotifierState = new Map([["A::5h", { remaining: 30, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
    });
    const r = decideNotifications(
      makeInput({ prev, model, suppressed: new Set(["a"]) }),
    );
    expect(r.notifications).toHaveLength(0);
    // Suppressed providers are skipped entirely — no state update.
    expect(r.next.get("A::5h")?.remaining).toBe(30);
  });

  it("suppression is case-insensitive", () => {
    const prev: NotifierState = new Map([["OpenAI::5h", { remaining: 30, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "OpenAI", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
    });
    const r = decideNotifications(
      makeInput({ prev, model, suppressed: new Set(["openai"]) }),
    );
    expect(r.notifications).toHaveLength(0);
  });
});

describe("decideNotifications — error model", () => {
  it("preserves state and fires nothing for an error model", () => {
    const prev: NotifierState = new Map([
      ["A::5h", { remaining: 20, lastNotifiedAt: 500_000 }],
    ]);
    const r = decideNotifications(makeInput({ prev, model: { error: "fail" } }));
    expect(r.notifications).toHaveLength(0);
    expect(r.next.get("A::5h")?.remaining).toBe(20);
  });
});

describe("decideNotifications — multiple providers/windows", () => {
  it("fires one notification per crossing key in a single poll", () => {
    const prev: NotifierState = new Map([
      ["A::5h", { remaining: 30, lastNotifiedAt: undefined }],
      ["A::Weekly", { remaining: 30, lastNotifiedAt: undefined }],
      ["B::Monthly", { remaining: 30, lastNotifiedAt: undefined }],
    ]);
    const model = makeModel({
      providers: [
        {
          name: "A",
          minRemaining: 20,
          windows: [
            { label: "5h", remaining: 20 },
            { label: "Weekly", remaining: 28 }, // stays above threshold
          ],
        },
        {
          name: "B",
          minRemaining: 10,
          windows: [{ label: "Monthly", remaining: 10 }],
        },
      ],
    });
    const r = decideNotifications(makeInput({ prev, model }));
    expect(new Set(names(r))).toEqual(new Set(["A::5h:crossed", "B::Monthly:crossed"]));
  });

  it("does not mutate the input prev map", () => {
    const prev: NotifierState = new Map([["A::5h", { remaining: 30, lastNotifiedAt: undefined }]]);
    const model = makeModel({
      providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
    });
    decideNotifications(makeInput({ prev, model }));
    expect(prev.get("A::5h")?.remaining).toBe(30);
  });
});

describe("suppressedFromConfig", () => {
  it("merges disabled and hidden, lowercased", () => {
    const cfg: MyStatusConfig = {
      providers: { disabled: ["XAI", "LongCat"], hidden: ["openai"] },
    };
    expect(suppressedFromConfig(cfg)).toEqual(new Set(["xai", "longcat", "openai"]));
  });

  it("returns empty set when providers is undefined", () => {
    expect(suppressedFromConfig({})).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// NotifierManager — with mocked electron Notification
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NotifierManager — with injected recording factory
// ---------------------------------------------------------------------------

class StubNotification {
  opts: Electron.NotificationConstructorOptions;
  shown = false;
  clickHandler: (() => void) | null = null;
  constructor(opts: Electron.NotificationConstructorOptions) {
    this.opts = opts;
  }
  show() {
    this.shown = true;
  }
  on(event: string, cb: () => void) {
    if (event === "click") this.clickHandler = cb;
  }
}

const FAKE_PREFS: DesktopPrefs = {
  threshold: 25,
  trendMode: undefined,
  notifications: true,
  notifyCooldownMin: 60,
  lastTab: undefined,
  windowBounds: undefined,
  launchAtLogin: false,
};

function makePush(model: MyStatusViewModel): PushPayload {
  return { model, fetchedAt: 0, nextFetchAt: 0 };
}

describe("NotifierManager", () => {
  let created: StubNotification[];

  beforeEach(() => {
    vi.clearAllMocks();
    created = [];
  });

  function makeManager(overrides: {
    prefs?: Partial<DesktopPrefs>;
    config?: MyStatusConfig;
    onClick?: (provider: string) => void;
  } = {}): NotifierManager {
    return new NotifierManager({
      loadPrefs: () => ({ ...FAKE_PREFS, ...overrides.prefs }),
      loadConfig: () => overrides.config ?? {},
      now: () => 1_000_000,
      createNotification: (opts) => {
        const stub = new StubNotification(opts);
        created.push(stub);
        return stub;
      },
      onClick: overrides.onClick ?? vi.fn(),
    });
  }

  it("fires nothing on the baseline poll", () => {
    const mgr = makeManager();
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 10, windows: [{ label: "5h", remaining: 10 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(0);
    mgr.destroy();
  });

  it("fires one notification on a crossing after baseline", () => {
    const mgr = makeManager();
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    // Baseline: A at 30.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 30, windows: [{ label: "5h", remaining: 30 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(0);
    // Crossing: A drops to 20.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.opts.title).toBe("A low: 5h");
    expect(created[0]?.shown).toBe(true);
    mgr.destroy();
  });

  it("does not fire on repeated sub-threshold polls inside cooldown", () => {
    const mgr = makeManager();
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    // Baseline at 30.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 30, windows: [{ label: "5h", remaining: 30 }] }],
        }),
      ),
    );
    // Crossing to 20 — fires.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(1);
    // Recovery to 40 — fires recovered (not cooldown-gated).
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 40, windows: [{ label: "5h", remaining: 40 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(2);
    expect(created[1]?.opts.title).toBe("A recovered: 5h");
    // Drop again to 20 — within cooldown (lastNotifiedAt was the first fire).
    // But now() is fixed at 1_000_000 and the first fire was also at 1_000_000,
    // so the cooldown (60min) has NOT elapsed. Suppressed.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(2);
    mgr.destroy();
  });

  it("fires a recovery notification", () => {
    const mgr = makeManager();
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    // Baseline at 20 (below threshold).
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(0);
    // Recovery to 40.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 40, windows: [{ label: "5h", remaining: 40 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.opts.title).toBe("A recovered: 5h");
    mgr.destroy();
  });

  it("suppresses notifications for hidden providers", () => {
    const mgr = makeManager({
      config: { providers: { hidden: ["a"] } },
    });
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    // Baseline at 30.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 30, windows: [{ label: "5h", remaining: 30 }] }],
        }),
      ),
    );
    // Crossing to 20 — suppressed because A is hidden.
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(0);
    mgr.destroy();
  });

  it("suppresses notifications for disabled providers", () => {
    const mgr = makeManager({
      config: { providers: { disabled: ["a"] } },
    });
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 30, windows: [{ label: "5h", remaining: 30 }] }],
        }),
      ),
    );
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(0);
    mgr.destroy();
  });

  it("does nothing when notifications pref is false", () => {
    const mgr = makeManager({ prefs: { notifications: false } });
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 30, windows: [{ label: "5h", remaining: 30 }] }],
        }),
      ),
    );
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(0);
    mgr.destroy();
  });

  it("click handler calls onClick with the provider name", () => {
    const onClick = vi.fn();
    const mgr = makeManager({ onClick });
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 30, windows: [{ label: "5h", remaining: 30 }] }],
        }),
      ),
    );
    pollCb?.(
      makePush(
        makeModel({
          providers: [{ name: "A", minRemaining: 20, windows: [{ label: "5h", remaining: 20 }] }],
        }),
      ),
    );
    expect(created).toHaveLength(1);
    created[0]?.clickHandler?.();
    expect(onClick).toHaveBeenCalledWith("A");
    mgr.destroy();
  });

  it("handles an error model without throwing or firing", () => {
    const mgr = makeManager();
    let pollCb: ((p: PushPayload) => void) | null = null;
    mgr.start((cb) => {
      pollCb = cb;
      return () => {
        pollCb = null;
      };
    });
    expect(() => {
      pollCb?.({ model: { error: "fail" }, fetchedAt: 0, nextFetchAt: 0 });
    }).not.toThrow();
    expect(created).toHaveLength(0);
    mgr.destroy();
  });

  it("start is idempotent", () => {
    const mgr = makeManager();
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

  it("destroy unsubscribes", () => {
    const mgr = makeManager();
    let unsubscribed = false;
    mgr.start(() => () => {
      unsubscribed = true;
      return () => {};
    });
    mgr.destroy();
    expect(unsubscribed).toBe(true);
  });
});