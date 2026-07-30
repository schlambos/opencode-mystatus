import { useEffect, useRef, useState, type JSX } from "react";
import type { ExportResponse, MyStatusArgs, SaveExportResult } from "../../shared/ipc";
import { stripAnsi } from "../lib/ansi";
import { getBridge } from "../lib/bridge";

type ExportFormat = "json" | "ansi";

interface ExportMenuProps {
  args: () => MyStatusArgs;
}

interface MenuState {
  open: boolean;
  busy: string | null;
  notice: { kind: "ok" | "error"; text: string } | null;
}

const INITIAL: MenuState = { open: false, busy: null, notice: null };

function clipboardAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.writeText === "function"
  );
}

async function copyToClipboard(text: string): Promise<void> {
  if (clipboardAvailable()) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for the test harness / headless: a no-op that does not throw.
}

export function ExportMenu({ args }: ExportMenuProps): JSX.Element {
  const [state, setState] = useState<MenuState>(INITIAL);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.open) return;
    function onPointer(event: MouseEvent): void {
      if (ref.current === null) return;
      if (!ref.current.contains(event.target as Node)) {
        setState((s) => ({ ...s, open: false }));
      }
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [state.open]);

  useEffect(() => {
    if (state.notice === null) return;
    const timer = setTimeout(() => setState((s) => ({ ...s, notice: null })), 4000);
    return () => clearTimeout(timer);
  }, [state.notice]);

  async function runCopy(format: ExportFormat): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      setState((s) => ({ ...s, open: false, notice: { kind: "error", text: "bridge unavailable" } }));
      return;
    }
    setState((s) => ({ ...s, open: false, busy: `copy-${format}` }));
    try {
      const res: ExportResponse = await bridge.getExport({ format, args: args() });
      const text = format === "ansi" ? stripAnsi(res.text) : res.text;
      await copyToClipboard(text);
      setState((s) => ({ ...s, busy: null, notice: { kind: "ok", text: format === "json" ? "JSON copied" : "Card text copied" } }));
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: null,
        notice: { kind: "error", text: err instanceof Error ? err.message : "Copy failed" },
      }));
    }
  }

  async function runSave(format: ExportFormat): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      setState((s) => ({ ...s, open: false, notice: { kind: "error", text: "bridge unavailable" } }));
      return;
    }
    setState((s) => ({ ...s, open: false, busy: `save-${format}` }));
    try {
      const result: SaveExportResult = await bridge.saveExport({ format, args: args() });
      if (result.ok) {
        setState((s) => ({
          ...s,
          busy: null,
          notice: { kind: "ok", text: format === "json" ? `Saved JSON — ${result.path}` : `Saved text — ${result.path}` },
        }));
      } else if ("cancelled" in result && result.cancelled) {
        setState((s) => ({ ...s, busy: null }));
      } else {
        setState((s) => ({
          ...s,
          busy: null,
          notice: { kind: "error", text: "error" in result ? result.error : "Save failed" },
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: null,
        notice: { kind: "error", text: err instanceof Error ? err.message : "Save failed" },
      }));
    }
  }

  const busy = state.busy;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="export-menu-button"
        aria-label="Export menu"
        aria-haspopup="menu"
        aria-expanded={state.open}
        onClick={() => setState((s) => ({ ...s, open: !s.open }))}
        disabled={busy !== null}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ink-700 bg-ink-900 text-fog-400 transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden
        >
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {state.open && (
        <div
          role="menu"
          data-testid="export-menu"
          className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-xl"
        >
          <MenuItem
            testId="export-copy-json"
            label="Copy JSON"
            disabled={busy !== null}
            onClick={() => void runCopy("json")}
          />
          <MenuItem
            testId="export-save-json"
            label="Save JSON…"
            disabled={busy !== null}
            onClick={() => void runSave("json")}
          />
          <div className="my-1 border-t border-ink-800" />
          <MenuItem
            testId="export-copy-text"
            label="Copy card text"
            disabled={busy !== null}
            onClick={() => void runCopy("ansi")}
          />
          <MenuItem
            testId="export-save-text"
            label="Save text…"
            disabled={busy !== null}
            onClick={() => void runSave("ansi")}
          />
        </div>
      )}

      {busy !== null && (
        <span
          data-testid="export-busy"
          className="absolute right-0 top-10 font-mono text-[10px] text-fog-400"
        >
          {busy.startsWith("save") ? "saving…" : "copying…"}
        </span>
      )}

      {state.notice !== null && (
        <p
          data-testid="export-notice"
          role="status"
          className={`absolute right-0 top-10 max-w-xs truncate font-mono text-[10px] ${
            state.notice.kind === "ok" ? "text-status-ok" : "text-status-low"
          }`}
          title={state.notice.text}
        >
          {state.notice.text}
        </p>
      )}
    </div>
  );
}

interface MenuItemProps {
  testId: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

function MenuItem({ testId, label, disabled, onClick }: MenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="block w-full px-3.5 py-2 text-left text-xs text-fog-200 transition-colors hover:bg-ink-800 hover:text-fog-100 focus-visible:bg-ink-800 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}