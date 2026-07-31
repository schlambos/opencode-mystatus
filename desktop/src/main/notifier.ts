// Threshold-crossing notifications (todo 17).
//
// On each pushed view model, decide which provider windows crossed below
// the threshold (was >= threshold, now < threshold) and which recovered
// (was < threshold, now >= threshold). Notifications fire ONLY on edge
// transitions — a provider sitting below threshold across many polls
// produces one notification, not many — enforced by a per-key cooldown.
// The very first model after app start is treated as a baseline: no
// notifications fire for it (every window is "newly below" by definition,
// which is not a crossing).
//
// State is keyed by `(provider, windowLabel)`. The cooldown is per-key and
// configurable via the desktop prefs store (`notifyCooldownMin`, default 60).
// Hidden and disabled providers are suppressed entirely — the user has
// opted them out of the dashboard, so they must not nag.
//
// The decision function is PURE (no Electron, no side effects) so it can be
// unit-tested without mocking anything. The NotifierManager wraps it,
// owns the in-memory state, and fires Electron `Notification` objects —
// mocked as `Notification` in tests via vi.mock.

import { Notification } from "electron";
import type {
  DesktopPrefs,
  MyStatusConfig,
  MyStatusViewModel,
  PushPayload,
  ViewModelResult,
} from "../shared/ipc.js";
import { loadPrefs } from "./prefs.js";

/**
 * Per-key state: the last known remaining percent and the epoch ms of the
 * most recent notification fire. `undefined` remaining means we have never
 * seen the key (first observation).
 */
export interface KeyState {
  remaining: number | undefined;
  lastNotifiedAt: number | undefined;
}

/** Map keyed by `${provider}::${windowLabel}`. */
export type NotifierState = Map<string, KeyState>;

export interface DecideInput {
  readonly prev: NotifierState;
  readonly model: ViewModelResult;
  readonly threshold: number;
  /** Cooldown window in ms. A key that fired within the last `cooldownMs` is suppressed. */
  readonly cooldownMs: number;
  /** Lower-cased provider names to suppress (hidden + disabled). */
  readonly suppressed: ReadonlySet<string>;
  /** Epoch ms for cooldown comparison. */
  readonly now: number;
  /** When true, this is the first model after app start — baseline, no notifications. */
  readonly isBaseline: boolean;
}

export type NotificationKind = "crossed" | "recovered";

export interface PendingNotification {
  readonly provider: string;
  readonly windowLabel: string;
  readonly remaining: number;
  readonly kind: NotificationKind;
}

export interface DecideResult {
  /** Notifications to fire this cycle (already cooldown-filtered). */
  readonly notifications: readonly PendingNotification[];
  /** New state to store (a fresh Map; the input `prev` is not mutated). */
  readonly next: NotifierState;
}

function keyOf(provider: string, windowLabel: string): string {
  return `${provider}::${windowLabel}`;
}

function isSuppressed(provider: string, suppressed: ReadonlySet<string>): boolean {
  return suppressed.has(provider.toLowerCase());
}

/**
 * Pure decision function. Given the previous per-key state and the current
 * view model, returns the notifications to fire and the updated state.
 *
 * Edge semantics (mirrors plugin/mystatus.ts:7340-7348 bucketing):
 *   - crossed: prev.remaining >= threshold AND cur.remaining < threshold
 *   - recovered: prev.remaining < threshold AND cur.remaining >= threshold
 *
 * The first observation of a key (prev.remaining === undefined) is NOT a
 * crossing — it is recorded as the baseline. When `isBaseline` is true
 * (the very first model after app start), no notifications fire at all;
 * the state is seeded from the model so the next poll can detect real
 * crossings.
 *
 * Cooldown applies only to `crossed` notifications: a key that fired within
 * the last `cooldownMs` is suppressed (state still updates). Recovery
 * notifications are not cooldown-gated — a recovery is a single event.
 */
export function decideNotifications(input: DecideInput): DecideResult {
  if ("error" in input.model) {
    // An error model carries no provider data — preserve state, fire nothing.
    return { notifications: [], next: new Map(input.prev) };
  }
  const vm: MyStatusViewModel = input.model;
  const next: NotifierState = new Map(input.prev);
  const notifications: PendingNotification[] = [];

  for (const provider of vm.providers) {
    if (isSuppressed(provider.name, input.suppressed)) continue;
    for (const w of provider.windows) {
      const k = keyOf(provider.name, w.label);
      const prev = next.get(k);
      const cur = w.remaining;
      const prevRem = prev?.remaining;

      if (prevRem === undefined) {
        // First time we see this key — seed baseline, no notification.
        next.set(k, { remaining: cur, lastNotifiedAt: prev?.lastNotifiedAt });
        continue;
      }

      const wasBelow = prevRem < input.threshold;
      const nowBelow = cur < input.threshold;

      if (input.isBaseline) {
        // Baseline poll: seed/refresh state, fire nothing.
        next.set(k, { remaining: cur, lastNotifiedAt: prev?.lastNotifiedAt });
        continue;
      }

      if (!wasBelow && nowBelow) {
        // Crossing down.
        const lastNotifiedAt = prev?.lastNotifiedAt;
        const inCooldown =
          lastNotifiedAt !== undefined && input.now - lastNotifiedAt < input.cooldownMs;
        next.set(k, {
          remaining: cur,
          lastNotifiedAt: inCooldown ? lastNotifiedAt : input.now,
        });
        if (!inCooldown) {
          notifications.push({
            provider: provider.name,
            windowLabel: w.label,
            remaining: cur,
            kind: "crossed",
          });
        }
      } else if (wasBelow && !nowBelow) {
        // Recovery — not cooldown-gated.
        next.set(k, { remaining: cur, lastNotifiedAt: prev?.lastNotifiedAt });
        notifications.push({
          provider: provider.name,
          windowLabel: w.label,
          remaining: cur,
          kind: "recovered",
        });
      } else {
        // No transition — just refresh the remaining value.
        next.set(k, { remaining: cur, lastNotifiedAt: prev?.lastNotifiedAt });
      }
    }
  }

  return { notifications, next };
}

/** Build the suppressed-name set from a config (disabled + hidden, lowercased). */
export function suppressedFromConfig(cfg: MyStatusConfig): Set<string> {
  const out = new Set<string>();
  for (const d of cfg.providers?.disabled ?? []) out.add(d.toLowerCase());
  for (const h of cfg.providers?.hidden ?? []) out.add(h.toLowerCase());
  return out;
}

// ---------------------------------------------------------------------------
// NotifierManager — owns state, fires Electron Notifications, wired to poller.
// ---------------------------------------------------------------------------

export interface NotifierDeps {
  readonly loadPrefs: () => DesktopPrefs;
  readonly loadConfig: () => MyStatusConfig;
  readonly now: () => number;
  /** Factory so tests can inject a recording stub. Defaults to Electron's Notification. */
  readonly createNotification: (opts: Electron.NotificationConstructorOptions) => {
    show: () => void;
    on: (event: "click", cb: () => void) => void;
  };
  /** Called when a notification is clicked — wired to focus the dashboard. */
  readonly onClick: (provider: string) => void;
}

export class NotifierManager {
  private readonly deps: NotifierDeps;
  private state: NotifierState = new Map();
  private baseline = true;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: NotifierDeps) {
    this.deps = deps;
  }

  /**
   * Subscribe to poll updates. The callback computes the suppressed set from
   * the current config, runs the pure decision, fires a Notification per
   * pending item, and stores the new state.
   */
  start(onPoll: (cb: (payload: PushPayload) => void) => () => void): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = onPoll((payload) => this.onPoll(payload));
  }

  /** Tear down the subscription. Safe to call when not started. */
  destroy(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Reset to baseline (e.g. for tests). Clears state and re-arms the baseline flag. */
  resetForTest(): void {
    this.state = new Map();
    this.baseline = true;
  }

  private onPoll(payload: PushPayload): void {
    const prefs = this.deps.loadPrefs();
    if (!prefs.notifications) return;

    const cfg = this.deps.loadConfig();
    const suppressed = suppressedFromConfig(cfg);
    const result = decideNotifications({
      prev: this.state,
      model: payload.model,
      threshold: prefs.threshold,
      cooldownMs: prefs.notifyCooldownMin * 60_000,
      suppressed,
      now: this.deps.now(),
      isBaseline: this.baseline,
    });
    this.state = result.next;
    this.baseline = false;

    for (const n of result.notifications) {
      this.fire(n);
    }
  }

  private fire(n: PendingNotification): void {
    const title =
      n.kind === "crossed"
        ? `${n.provider} low: ${n.windowLabel}`
        : `${n.provider} recovered: ${n.windowLabel}`;
    const body =
      n.kind === "crossed"
        ? `${n.remaining}% remaining — below threshold.`
        : `${n.remaining}% remaining — back above threshold.`;
    try {
      const note = this.deps.createNotification({ title, body });
      note.on("click", () => this.deps.onClick(n.provider));
      note.show();
    } catch {
      // Notification unsupported (e.g. Linux headless CI): no-op, do not crash.
      // The poll cycle is unaffected — this is the documented failure path.
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton wired to real Electron + prefs + config.
// ---------------------------------------------------------------------------

let singleton: NotifierManager | null = null;

export interface NotifierSingletonDeps {
  readonly loadConfig: () => MyStatusConfig;
  readonly onClick: (provider: string) => void;
}

export function getNotifier(deps: NotifierSingletonDeps): NotifierManager {
  if (singleton === null) {
    singleton = new NotifierManager({
      loadPrefs,
      loadConfig: deps.loadConfig,
      now: () => Date.now(),
      createNotification: (opts) => new Notification(opts),
      onClick: deps.onClick,
    });
  }
  return singleton;
}

export function resetNotifierForTest(): void {
  if (singleton !== null) {
    singleton.destroy();
    singleton = null;
  }
}