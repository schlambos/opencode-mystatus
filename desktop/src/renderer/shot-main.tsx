import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardPane } from "./pages/DashboardPane";
import { injectStatusSnapshot } from "./lib/store";
import "./styles.css";

const H = 3_600_000;
const D = 24 * H;
const now = Date.now();

injectStatusSnapshot({
  model: {
    summary: {
      accounts: 3,
      green: 1,
      yellow: 1,
      red: 1,
      lowest: { provider: "Kimi", label: "Weekly", remaining: 0 },
      soonest: { provider: "Kimi", label: "5-hour", resetMs: 4 * H },
    },
    providers: [
      {
        name: "Kimi",
        minRemaining: 0,
        windows: [
          { label: "5-hour", remaining: 100, resetMs: 4 * H },
          { label: "Weekly", remaining: 0, resetMs: 5 * D },
        ],
      },
      {
        name: "Anthropic Account Quota",
        minRemaining: 49,
        windows: [
          { label: "5-hour limit", remaining: 49, resetMs: 70 * 60_000 },
          { label: "7-day limit", remaining: 72, resetMs: 4 * D },
          { label: "Monthly plan total", remaining: 84, resetMs: 29 * D },
        ],
      },
      {
        name: "Poe",
        minRemaining: 46,
        windows: [{ label: "Plan points", remaining: 46, resetMs: 11 * D }],
        stale: { ageMs: 5 * H, reason: "token expired" },
      },
    ],
    errors: [],
    alerts: [],
    threshold: 25,
    issues: [],
    health: { queried: 3, rendered: 3, stale: 1, failed: 0, unconfigured: 0 },
  },
  fetchedAt: now,
  now,
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

createRoot(rootEl).render(
  <StrictMode>
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950 text-fog-100">
      <DashboardPane />
    </div>
  </StrictMode>,
);
