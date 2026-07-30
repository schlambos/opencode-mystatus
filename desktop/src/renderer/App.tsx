import { useEffect, useState, type JSX } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar, type Route } from "./components/Sidebar";
import { connectStatusStore } from "./lib/store";
import { CredentialsPane } from "./pages/CredentialsPane";
import { DashboardPane } from "./pages/DashboardPane";
import { SettingsPane } from "./pages/SettingsPane";

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
  // Simple state routing — react-router is deliberately not a dependency.
  const [route, setRoute] = useState<Route>("dashboard");

  useEffect(() => connectStatusStore(), []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-950 text-fog-100">
      <Sidebar route={route} onNavigate={setRoute} />
      <main className="console-bg flex-1 overflow-y-auto">
        <ErrorBoundary>{paneFor(route)}</ErrorBoundary>
      </main>
    </div>
  );
}
