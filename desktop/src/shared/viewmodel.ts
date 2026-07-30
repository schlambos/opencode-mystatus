// Runtime validation for payloads crossing the context-isolation boundary.
// The TYPE contract lives in shared/ipc.ts (todo 2); this module only decides
// whether an `unknown` push payload actually satisfies it, so the renderer
// parses at the boundary and never trusts IPC input blindly.

import type { HistoryResponse, MyStatusViewModel, PushPayload } from "./ipc.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Shape check for the success branch of ViewModelResult. */
export function isViewModel(x: unknown): x is MyStatusViewModel {
  if (!isRecord(x)) return false;
  return isRecord(x["summary"]) && Array.isArray(x["providers"]);
}

function isViewModelResult(x: unknown): boolean {
  if (!isRecord(x)) return false;
  return isViewModel(x) || typeof x["error"] === "string";
}

export function isPushPayload(x: unknown): x is PushPayload {
  if (!isRecord(x)) return false;
  if (!isViewModelResult(x["model"])) return false;
  return typeof x["fetchedAt"] === "number" && typeof x["nextFetchAt"] === "number";
}

/** Shape check for the mystatus:history response (todo 7). */
export function isHistoryResponse(x: unknown): x is HistoryResponse {
  if (!isRecord(x)) return false;
  return Array.isArray(x["snapshots"]);
}

/** Human-readable reason for a rejected payload, for the recoverable error panel. */
export function describePayloadProblem(x: unknown): string {
  if (!isRecord(x)) return "payload is not an object";
  if (!isRecord(x["model"])) return "model missing or not an object";
  if (!isViewModelResult(x["model"])) return "model is neither a view model nor an error result";
  if (typeof x["fetchedAt"] !== "number") return "fetchedAt missing or not a number";
  if (typeof x["nextFetchAt"] !== "number") return "nextFetchAt missing or not a number";
  return "payload failed validation";
}
