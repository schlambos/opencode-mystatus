import { useEffect, useState, type JSX } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { connectStatusStore } from "./lib/store";
import { CredentialsPane } from "./pages/CredentialsPane";
import { DashboardPane } from "./pages/DashboardPane";
import { SettingsPane } from "./pages/SettingsPane";

export type Route = "dashboard" | "credentials" | "settings";

const NAV: ReadonlyArray<{ id: Route; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "credentials", label: "Accounts" },
  { id: "settings", label: "Settings" },
];

function TopBar({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
}): JSX.Element {
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-ink-800 px-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 font-mono text-sm font-bold text-accent">
          m
        </span>
        <span className="font-mono text-sm font-semibold tracking-tight text-fog-100">mystatus</span>
      </div>

      <nav className="absolute left-1/2 -translate-x-1/2" aria-label="Main">
        <div className="inline-flex rounded-full border border-ink-700 bg-ink-900/80 p-1">
          {NAV.map((item) => {
            const active = item.id === route;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
                className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-ink-700 text-fog-100" : "text-fog-400 hover:text-fog-100"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          title="Refresh"
          onClick={() => void window.mystatus?.refresh?.()}
          className="rounded-md p-2 text-fog-500 transition-colors hover:bg-ink-800 hover:text-fog-200"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function paneFor(route: Route): JSX.Element {
  switch (route) {
    case "dashboard":
      return <DashboardPane />;
    case "credentials":
      return <CredentialsPane />;
    case "settings":
      return <SettingsPane />;
    default: {
      const unreachable: never = route;
      throw new Error(`unknown route: ${String(unreachable)}`);
    }
  }
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>("dashboard");

  useEffect(() => connectStatusStore(), []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950 text-fog-100">
      <TopBar route={route} onNavigate={setRoute} />
      <main className="flex-1 overflow-y-auto">
        <ErrorBoundary>{paneFor(route)}</ErrorBoundary>
      </main>
    </div>
  );
}
