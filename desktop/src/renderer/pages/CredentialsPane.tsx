import type { JSX } from "react";
import { PaneShell } from "../components/PaneShell";

export function CredentialsPane(): JSX.Element {
  return (
    <PaneShell testId="pane-credentials" kicker="Wave 3" title="Credentials">
      <div className="animate-rise max-w-2xl rounded-lg border border-ink-700 bg-ink-900 p-6">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7 text-fog-500"
          aria-hidden
        >
          <path d="M2.59 17.41A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4-4z" />
          <circle cx="16.5" cy="7.5" r="0.5" fill="currentColor" />
        </svg>
        <p className="mt-4 text-sm leading-relaxed text-fog-300">
          In-app provider sign-in lands in wave 3: isolated capture windows for the cookie
          providers, guided paste for Copilot PATs and Poe API keys, per-provider connection
          tests, and expiry visibility.
        </p>
        <p className="mt-3 font-mono text-xs text-fog-500">
          Until then, credentials are managed as JSON files under ~/.config/opencode/ — same as the
          CLI.
        </p>
      </div>
    </PaneShell>
  );
}
