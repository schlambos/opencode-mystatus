import { useState, type JSX } from "react";

export type PasteStatus = "idle" | "saving" | "saved" | "error";

export interface PasteSectionState {
  readonly status: PasteStatus;
  readonly message: string;
  readonly savedPath?: string;
}

export const IDLE: PasteSectionState = { status: "idle", message: "" };

export function statusChipClass(status: PasteStatus): string {
  switch (status) {
    case "idle":
      return "text-fog-500";
    case "saving":
      return "text-fog-300";
    case "saved":
      return "text-status-ok";
    case "error":
      return "text-status-dead";
  }
}

export function PresenceBadge({
  configured,
  oauth,
}: {
  configured: boolean;
  oauth: boolean;
}): JSX.Element {
  if (configured) {
    return (
      <span className="rounded-full bg-status-ok/20 px-2 py-0.5 text-xs text-status-ok">
        file present
      </span>
    );
  }
  if (oauth) {
    return (
      <span className="rounded-full bg-status-warn/20 px-2 py-0.5 text-xs text-status-warn">
        OAuth only
      </span>
    );
  }
  return (
    <span className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-fog-400">not set</span>
  );
}

interface MaskedFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder: string;
  readonly testId: string;
}

export function MaskedField(props: MaskedFieldProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium text-fog-400">{props.label}</label>
      <div className="mt-1 flex gap-2">
        <input
          data-testid={props.testId}
          type={revealed ? "text" : "password"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-sm text-fog-100"
        />
        <button
          data-testid={`${props.testId}-reveal`}
          onClick={() => setRevealed((r) => !r)}
          className="rounded border border-ink-600 px-3 py-2 text-xs text-fog-400 hover:border-fog-400"
        >
          {revealed ? "hide" : "show"}
        </button>
      </div>
    </div>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder: string;
  readonly testId: string;
}

export function TextField(props: TextFieldProps): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium text-fog-400">{props.label}</label>
      <input
        data-testid={props.testId}
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete="off"
        spellCheck={false}
        className="mt-1 w-full rounded border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-fog-100"
      />
    </div>
  );
}

interface SaveBarProps {
  readonly saveTestId: string;
  readonly linkTestId: string;
  readonly linkUrl: string;
  readonly linkLabel: string;
  readonly statusTestId: string;
  readonly state: PasteSectionState;
  readonly onSave: () => void;
  readonly onOpenLink: (url: string) => void;
}

export function SaveBar(props: SaveBarProps): JSX.Element {
  return (
    <>
      <div className="mt-4 flex items-center gap-3">
        <button
          data-testid={props.saveTestId}
          onClick={props.onSave}
          className="rounded bg-fog-100 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-fog-200"
        >
          Save
        </button>
        <button
          data-testid={props.linkTestId}
          onClick={() => props.onOpenLink(props.linkUrl)}
          className="rounded border border-ink-600 px-4 py-2 text-sm text-fog-300 hover:border-fog-400"
        >
          {props.linkLabel}
        </button>
        <span
          data-testid={props.statusTestId}
          className={`text-xs ${statusChipClass(props.state.status)}`}
        >
          {props.state.message}
        </span>
      </div>
      {props.state.savedPath !== undefined && props.state.status === "saved" && (
        <p className="mt-2 font-mono text-xs text-fog-500">{props.state.savedPath}</p>
      )}
    </>
  );
}