// Hidden-provider state for the dashboard. Hidden names are the provider card
// name lower-cased (TUI convention — plugin/tui.ts:600, 659) and persist to
// `providers.hidden` in mystatus.json. Hidden providers stay in the pushed
// view model (still queried) and are filtered client-side.
//
// `providers.hidden` is NOT `providers.disabled` — different mechanisms.

import type { MyStatusConfig, MyStatusViewProvider } from "../../shared/ipc";
import { getBridge } from "./bridge";
import { reloadConfig } from "./store";

/** Lower-cased hidden-name set from the config snapshot (empty when absent). */
export function hiddenNameSet(config: MyStatusConfig | null): Set<string> {
  return new Set((config?.providers?.hidden ?? []).map((n) => n.toLowerCase()));
}

/** Providers whose name (lower-cased) is in the hidden set, model order kept. */
export function hiddenProviders(
  providers: MyStatusViewProvider[],
  hidden: Set<string>,
): MyStatusViewProvider[] {
  return providers.filter((p) => hidden.has(p.name.toLowerCase()));
}

// Mutations are serialized through a promise queue so rapid hide/unhide clicks
// are last-write-wins by call order: each write re-reads the live config and
// writes the resulting hidden list, never a delta applied to a stale snapshot.
let queue: Promise<void> = Promise.resolve();

/**
 * Hide or unhide one provider by card name.
 *
 * The renderer MUST re-read the config and send a fully-formed `providers`
 * object: core saveConfig is a SHALLOW merge (plugin/mystatus.ts:6740-6748),
 * so a bare `{ providers: { hidden } }` patch would wipe `disabled`/`order`.
 */
export function setProviderHidden(name: string, hide: boolean): Promise<void> {
  queue = queue.then(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    try {
      const cfg = await bridge.getConfig();
      const current = cfg.providers?.hidden ?? [];
      const without = current.filter((n) => n.toLowerCase() !== name.toLowerCase());
      const hidden = hide ? [...without, name] : without;
      await bridge.patchConfig({ providers: { ...cfg.providers, hidden } });
    } catch {
      // Best-effort, matching core saveConfig's silent failure (mystatus.ts:6745).
    }
    reloadConfig();
  });
  return queue;
}
