import type { JSX, ReactNode } from "react";

export interface SectionNotice {
  kind: "saved" | "error";
  text: string;
}

interface SectionCardProps {
  index: string;
  title: string;
  file: string;
  testId: string;
  dirty: boolean;
  problems: readonly string[];
  saving: boolean;
  notice: SectionNotice | null;
  onSave: () => void;
  children: ReactNode;
}

export function SectionCard({
  index,
  title,
  file,
  testId,
  dirty,
  problems,
  saving,
  notice,
  onSave,
  children,
}: SectionCardProps): JSX.Element {
  return (
    <section
      data-testid={testId}
      className="animate-rise rounded-lg border border-ink-700 bg-gradient-to-b from-ink-850 to-ink-900"
    >
      <header className="flex items-center gap-3 border-b border-ink-700/70 px-5 py-3.5">
        <span className="font-mono text-xs font-semibold text-accent/80 tabular-nums">{index}</span>
        <h2 className="text-sm font-semibold tracking-tight text-fog-100">{title}</h2>
        <span className="rounded border border-ink-600 bg-ink-950/60 px-1.5 py-0.5 font-mono text-[10px] text-fog-500">
          {file}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <p
            role="status"
            data-testid={`${testId}-notice`}
            className={`text-xs transition-opacity duration-300 ${
              notice === null
                ? "opacity-0"
                : notice.kind === "error"
                  ? "text-status-low"
                  : "text-status-ok"
            }`}
          >
            {notice?.text ?? ""}
          </p>
          <button
            type="button"
            data-testid={`${testId}-save`}
            disabled={!dirty || saving || problems.length > 0}
            onClick={onSave}
            className="relative rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-all duration-150 hover:-translate-y-px hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dirty && !saving && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-status-warn" aria-hidden />
            )}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>
      <div className="px-5 py-4">
        {problems.length > 0 && (
          <ul data-testid={`${testId}-problems`} className="mb-3 space-y-1">
            {problems.map((problem) => (
              <li key={problem} className="text-xs text-status-low">
                {problem}
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </section>
  );
}

export function FieldLabel({ label, htmlFor }: { label: string; htmlFor?: string }): JSX.Element {
  return (
    <p className="text-[10px] font-semibold tracking-[0.18em] text-fog-500 uppercase">
      {htmlFor === undefined ? label : <label htmlFor={htmlFor}>{label}</label>}
    </p>
  );
}

interface PillSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  testPrefix: string;
}

export function PillSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  testPrefix,
}: PillSelectProps<T>): JSX.Element {
  return (
    <div>
      <FieldLabel label={label} />
      <div
        role="group"
        aria-label={label}
        className="mt-1.5 inline-flex rounded-md border border-ink-700 bg-ink-950/70 p-0.5"
      >
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              data-testid={`${testPrefix}-${option}`}
              aria-pressed={active}
              onClick={() => onChange(option)}
              className={`rounded-[5px] px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none ${
                active
                  ? "bg-ink-700 text-fog-100 shadow-sm"
                  : "text-fog-500 hover:bg-ink-800 hover:text-fog-200"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}

export function Toggle({ label, description, checked, onChange, testId }: ToggleProps): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <FieldLabel label={label} />
        {description !== undefined && <p className="mt-1 max-w-md text-xs text-fog-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none ${
          checked ? "border-accent/60 bg-accent/70" : "border-ink-600 bg-ink-800"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-fog-100 shadow transition-transform duration-150 ${
            checked ? "translate-x-4" : ""
          }`}
          aria-hidden
        />
      </button>
    </div>
  );
}


