import type { JSX } from "react";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-4 w-4",
  "aria-hidden": true,
} as const;

interface HideButtonProps {
  name: string;
  hidden: boolean;
  onToggle: (name: string) => void;
  className?: string;
}

/**
 * Eye / eye-slash toggle for a provider card. Presentational: the Dashboard
 * owns the hidden set (useHiddenProviders) and passes the callback down.
 */
export function HideButton({ name, hidden, onToggle, className }: HideButtonProps): JSX.Element {
  const label = hidden ? `Show ${name}` : `Hide ${name}`;
  return (
    <button
      type="button"
      data-testid={`hide-${name.toLowerCase().replace(/\s+/g, "-")}`}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
      onClick={() => onToggle(name)}
      className={`rounded-md p-1.5 text-fog-500 transition-colors duration-150 hover:bg-ink-800 hover:text-fog-100 ${className ?? ""}`}
    >
      {hidden ? (
        <svg {...iconProps}>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
          <path d="m2 2 20 20" />
        </svg>
      ) : (
        <svg {...iconProps}>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}
