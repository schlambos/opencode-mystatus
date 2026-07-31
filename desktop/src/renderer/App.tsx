import { useEffect, useState, type JSX } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { connectStatusStore, useStatusState } from "./lib/store";
import { formatAge } from "./lib/status";
import { CredentialsPane } from "./pages/CredentialsPane";
import { DashboardPane } from "./pages/DashboardPane";
import { SettingsPane } from "./pages/SettingsPane";

type Route = "list" | "credentials" | "settings";

function Header({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
}): JSX.Element {
  const { fetchedAt, now } = useStatusState();
  const age = fetchedAt === null ? null : formatAge(Math.max(0, Math.floor((now - fetchedAt) / 1000)));

  return (
    <header className="flex items-center gap-3 border-b border-ink-800 px-6 py-3">
      <button
        type="button"
        onClick={() => onNavigate("list")}
        className="text-sm font-semibold tracking-tight text-fog-100"
      >
        mystatus
      </button>
      {age !== null && route === "list" && (
        <span className="font-mono text-xs text-fog-600">{age} ago</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => void window.mystatus?.refresh?.()}
          title="Refresh"
          className="rounded px-2 py-1 text-xs text-fog-500 hover:bg-ink-800 hover:text-fog-200"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={() => onNavigate(route === "credentials" ? "list" : "credentials")}
          className={`rounded px-2 py-1 text-xs hover:bg-ink-800 hover:text-fog-200 ${
            route === "credentials" ? "text-fog-100" : "text-fog-500"
          }`}
        >
          Accounts
        </button>
        <button
          type="button"
          onClick={() => onNavigate(route === "settings" ? "list" : "settings")}
          title="Settings"
          className={`rounded px-2 py-1 text-xs hover:bg-ink-800 hover:text-fog-200 ${
            route === "settings" ? "text-fog-100" : "text-fog-500"
          }`}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}

function paneFor(route: Route): JSX.Element {
  switch (route) {
    case "list":
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
  const [route, setRoute] = useState<Route>("list");

  useEffect(() => connectStatusStore(), []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950 text-fog-100">
      <Header route={route} onNavigate={setRoute} />
      <main className="flex-1 overflow-y-auto">
        <ErrorBoundary>{paneFor(route)}</ErrorBoundary>
      </main>
    </div>
  );
}
