// Export-to-file (todo 15).
//
// The dashboard overflow menu offers "Copy JSON" / "Save JSON…" / "Copy card
// text" / "Save text…". Copy paths live in the renderer (clipboard); save paths
// come through the mystatus:export:save IPC so the main process owns the
// native save dialog (dialog.showSaveDialog) and the filesystem write.
//
// The export payload comes from coreApi.getJsonExport / getAnsiExport (todo 2)
// — the main process never spawns bin/mystatus. For the ANSI "copy card text"
// path the renderer strips ANSI escape sequences before writing to the
// clipboard; for the "save text…" path the file keeps ANSI so a .txt opened
// in a terminal-aware viewer renders the same colors as the dashboard.
//
// stripAnsi is exported so the renderer (and tests) share one definition
// rather than re-deriving the ESC-sequence regex.

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { BrowserWindow, SaveDialogOptions, SaveDialogReturnValue } from "electron";
import type {
  ExportResponse,
  MyStatusArgs,
  SaveExportRequest,
  SaveExportResult,
} from "../shared/ipc.js";
import { coreApi } from "./core.js";

export interface ExportDeps {
  readonly showSaveDialog: (
    win: BrowserWindow,
    options: SaveDialogOptions,
  ) => Promise<SaveDialogReturnValue>;
}

function defaultExtension(format: SaveExportRequest["format"]): string {
  return format === "json" ? "json" : "txt";
}

function dialogFilters(format: SaveExportRequest["format"]): Electron.FileFilter[] {
  if (format === "json") {
    return [{ name: "JSON", extensions: ["json"] }];
  }
  // ANSI text — keep the .txt extension so the save dialog note ("ANSI colors
  // preserved") matches the file the user gets.
  return [{ name: "Text (ANSI)", extensions: ["txt"] }];
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Run an export and save it to a file chosen via the native save dialog.
 * Never throws — every failure path (cancelled, export error, write error)
 * resolves with a typed SaveExportResult so the renderer can show a toast
 * without a try/catch.
 */
export async function saveExport(
  win: BrowserWindow,
  req: SaveExportRequest,
  deps: ExportDeps,
): Promise<SaveExportResult> {
  const format = req.format === "json" ? "json" : "ansi";
  const args: MyStatusArgs = req.args ?? {};

  let exportRes: ExportResponse;
  try {
    exportRes =
      format === "json"
        ? await coreApi.getJsonExport(args)
        : await coreApi.getAnsiExport(args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // The core returns an error string in the text field on failure (coreApi
  // never throws). For JSON we can detect a failed export by attempting to
  // parse; for ANSI we surface the text verbatim and let the user see the
  // error in the saved file. The plan's failure scenario ("export while zero
  // providers configured") surfaces as a core error string — for JSON we
  // refuse to write a malformed file; for ANSI we still write so the user can
  // read the error.
  if (format === "json") {
    try {
      JSON.parse(exportRes.text);
    } catch {
      return { ok: false, error: exportRes.text };
    }
  }

  const ext = defaultExtension(format);
  const result = await deps.showSaveDialog(win, {
    title: format === "json" ? "Save JSON export" : "Save text export",
    defaultPath: `mystatus-export.${ext}`,
    filters: dialogFilters(format),
    // The note makes the ANSI-colors-preserved behavior explicit.
    message: format === "json" ? "Export the current snapshot as JSON" : "ANSI colors are preserved in the .txt file",
  });

  if (result.canceled || result.filePath === undefined) {
    return { ok: false, cancelled: true };
  }

  const filePath = result.filePath;
  try {
    ensureDir(dirname(filePath));
    writeFileSync(filePath, exportRes.text, "utf8");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, path: filePath };
}