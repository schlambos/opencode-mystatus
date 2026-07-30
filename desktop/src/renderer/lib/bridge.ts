import type { Bridge } from "../../shared/ipc.js";

/**
 * The preload bridge as the renderer sees it (todo 2 contract: ping,
 * getViewModel, getExport, getConfig, patchConfig, onViewModel). `refresh`
 * arrives with the todo-3 polling service and is optional until then —
 * call sites use optional chaining.
 */
export type RendererBridge = Bridge & {
  refresh?: () => Promise<unknown>;
};

// Optional at runtime despite the global declaration: if the preload script
// fails to load (e.g. format/sandbox mismatch), window.mystatus is undefined
// and the shell must degrade instead of white-screening.
export function getBridge(): RendererBridge | undefined {
  return (window as unknown as { mystatus?: RendererBridge }).mystatus;
}
