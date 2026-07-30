import { useState, type JSX } from "react";
import { FieldLabel } from "./fields";

interface NumFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
  unit?: string;
  hint?: string;
  min?: number;
}

export function NumField({ label, value, onChange, testId, unit, hint, min }: NumFieldProps): JSX.Element {
  return (
    <div>
      <FieldLabel label={label} htmlFor={testId} />
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={testId}
          type="number"
          data-testid={testId}
          value={value}
          min={min}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          className="w-24 rounded-md border border-ink-700 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-fog-100 tabular-nums transition-colors duration-150 hover:border-ink-600 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
        {unit !== undefined && <span className="font-mono text-[11px] text-fog-500">{unit}</span>}
      </div>
      {hint !== undefined && <p className="mt-1 text-[11px] text-fog-600">{hint}</p>}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  placeholder?: string;
  masked?: boolean;
  hint?: string;
}

export function TextField({
  label,
  value,
  onChange,
  testId,
  placeholder,
  masked = false,
  hint,
}: TextFieldProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const showPeek = masked && value.length > 0;
  return (
    <div>
      <FieldLabel label={label} htmlFor={testId} />
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={testId}
          type={masked && !revealed ? "password" : "text"}
          data-testid={testId}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className="w-full max-w-sm rounded-md border border-ink-700 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-fog-100 transition-colors duration-150 placeholder:text-fog-600 hover:border-ink-600 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
        {showPeek && (
          <button
            type="button"
            data-testid={`${testId}-peek`}
            aria-label={revealed ? "Hide value" : "Hold to reveal"}
            aria-pressed={revealed}
            onPointerDown={() => setRevealed(true)}
            onPointerUp={() => setRevealed(false)}
            onPointerLeave={() => setRevealed(false)}
            onBlur={() => setRevealed(false)}
            className="rounded-md border border-ink-700 bg-ink-950/70 px-2 py-1.5 text-[11px] text-fog-400 transition-colors duration-150 hover:border-ink-600 hover:text-fog-200 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
          >
            {revealed ? "hide" : "peek"}
          </button>
        )}
      </div>
      {hint !== undefined && <p className="mt-1 text-[11px] text-fog-600">{hint}</p>}
    </div>
  );
}
