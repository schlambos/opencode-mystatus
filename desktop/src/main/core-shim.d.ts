// Type-only shim for the `~core` module (plugin/mystatus.ts).
//
// WHY THIS EXISTS: the plugin core lives OUTSIDE this project's rootDir and
// carries its own inherited strict-mode debt (~150 errors under
// exactOptionalPropertyTypes + noUncheckedIndexedAccess) that the desktop
// gate must not absorb — the repo forbids editing plugin/ from the desktop
// workstream. Mapping `~core` to the real file via tsconfig paths pulls the
// whole plugin into the type graph, so the alias is deliberately NOT mapped
// here; this ambient declaration is the desktop's typed contract instead.
//
// Runtime resolution is unaffected: electron.vite.config.ts and
// vitest.config.ts alias `~core` to the real plugin file, so bundling and
// tests exercise the true implementation. core.test.ts round-trips real core
// output through the shared IPC types to lock structural compatibility.
//
// The surface below is typed against src/shared/ipc.ts, which mirrors the
// plugin's interfaces verbatim (see the comment block there).

declare module "~core" {
  import type {
    MyStatusArgs,
    MyStatusConfig,
    MyStatusViewModel,
  } from "../shared/ipc.js";

  /**
   * Opaque query snapshot (plugin/mystatus.ts:7156). The desktop never
   * inspects the snapshot — it passes it straight back into
   * buildMyStatusViewModel / formatMyStatus.
   */
  export interface MyStatusSnapshot {
    readonly ran: readonly unknown[];
    readonly fetchedAt: number;
    readonly authError?: string;
  }

  export function queryMyStatus(args: MyStatusArgs): Promise<MyStatusSnapshot>;

  export function buildMyStatusViewModel(
    snapshot: MyStatusSnapshot,
    args: MyStatusArgs,
  ): MyStatusViewModel | { error: string };

  export function formatMyStatus(
    snapshot: MyStatusSnapshot,
    args: MyStatusArgs,
  ): string;

  export function loadConfig(): MyStatusConfig;

  export function saveConfig(patch: Partial<MyStatusConfig>): void;
}
