// Typed main-process facade over the plugin core.
//
// The desktop app imports the plugin core in-process via the `~core` alias
// (electron.vite.config.ts → ../plugin/mystatus.ts). This module re-exposes
// a narrow typed API so the rest of the main process (IPC handlers, poller)
// never touches the core directly and never has to re-derive error shapes.
//
// Contract: every method resolves (never rejects). Errors from the core
// arrive as `{ error: string }` so the renderer can render them without a
// try/catch at every call site. The view model is passed through verbatim —
// no wrapping, no transformation, no field stripping.

import {
  queryMyStatus,
  buildMyStatusViewModel,
  formatMyStatus,
  loadConfig,
  saveConfig,
} from "~core";
import type {
  MyStatusArgs,
  MyStatusViewModel,
  MyStatusConfig,
  ViewModelResult,
  ExportResponse,
} from "../shared/ipc.js";

function isViewModel(value: ViewModelResult): value is MyStatusViewModel {
  return !("error" in value);
}

export const coreApi = {
  /** Query the core and build the structured view model. Never throws. */
  async getViewModel(args: MyStatusArgs = {}): Promise<ViewModelResult> {
    try {
      const snapshot = await queryMyStatus(args);
      const model = buildMyStatusViewModel(snapshot, args);
      return model;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** JSON export via core formatMyStatus with format:'json'. Never throws. */
  async getJsonExport(args: MyStatusArgs = {}): Promise<ExportResponse> {
    try {
      const snapshot = await queryMyStatus({ ...args, format: "json" });
      const text = formatMyStatus(snapshot, { ...args, format: "json" });
      return { format: "json", text };
    } catch (err) {
      return { format: "json", text: err instanceof Error ? err.message : String(err) };
    }
  },

  /** ANSI text export via core formatMyStatus with format:'ansi'. Never throws. */
  async getAnsiExport(args: MyStatusArgs = {}): Promise<ExportResponse> {
    try {
      const snapshot = await queryMyStatus({ ...args, format: "ansi" });
      const text = formatMyStatus(snapshot, { ...args, format: "ansi" });
      return { format: "ansi", text };
    } catch (err) {
      return { format: "ansi", text: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Read the current mystatus.json config. Never throws; returns {} on miss. */
  getConfig(): MyStatusConfig {
    return loadConfig();
  },

  /**
   * Shallow-merge a patch into mystatus.json via core saveConfig, then
   * re-read and return the resulting config. Never throws; on write
   * failure the pre-patch config is returned (core saveConfig swallows
   * errors silently — see plugin/mystatus.ts:6745-6747).
   */
  patchConfig(patch: Partial<MyStatusConfig>): MyStatusConfig {
    saveConfig(patch);
    return loadConfig();
  },
} as const;

export type CoreApi = typeof coreApi;

// Re-export the type guard for IPC handlers / poller that need to branch on
// the result shape without importing the shared union directly.
export { isViewModel };