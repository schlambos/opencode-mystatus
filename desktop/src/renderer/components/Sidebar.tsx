import type { JSX } from "react";
import { useStatusState } from "../lib/store";
import { formatAge } from "../lib/status";

export type Route = "dashboard" | "credentials" | "settings";

interface NavItem {
  id: Route;
  label: string;
  icon: JSX.Element;
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-4 w-4 shrink-0",
  "aria-hidden": true,
} as const;

const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: (
      <svg {...iconProps}>
        <path d="m12 14 4-4" />
        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      </svg>
    ),
  },
  {
    id: "credentials",
    label: "Credentials",
    icon: (
      <svg {...iconProps}>
        <path d="M2.59 17.41A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4-4z" />
        <circle cx="16.5" cy="7.5" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg {...iconProps}>
        <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
      </svg>
    ),
  },
];

const CONNECTION_LABEL: Record<string, string> = {
  connecting: "connecting",
  live: "live",
  error: "bridge down",
};

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function Sidebar({ route, onNavigate }: SidebarProps): JSX.Element {
  const { connection, fetchedAt, now } = useStatusState();

  const dotTone =
    connection === "live"
      ? "bg-status-ok"
      : connection === "connecting"
        ? "bg-status-warn animate-blink"
        : "bg-status-dead";

  return (
    <aside
      data-testid="sidebar"
      className="flex w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900"
    >
      {/* wordmark — TUI lineage: mono, lowercase, live dot */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${dotTone}`} aria-hidden />
          <span className="font-mono text-[15px] font-semibold tracking-tight text-fog-100">
            mystatus
          </span>
        </div>
        <p className="mt-1 pl-[18px] text-[10px] font-medium tracking-[0.24em] text-fog-500 uppercase">
          Quota console
        </p>
      </div>

      <p className="px-5 pb-2 text-[10px] font-semibold tracking-[0.2em] text-fog-600 uppercase">
        Views
      </p>
      <nav data-testid="sidebar-nav" className="flex flex-col gap-1 px-3" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const active = item.id === route;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}`}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
              className={`group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                active
                  ? "bg-ink-800 text-fog-100"
                  : "text-fog-400 hover:bg-ink-850 hover:text-fog-100"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-transform duration-200 ${
                  active ? "scale-y-100" : "scale-y-0"
                }`}
              />
              <span className={active ? "text-accent" : "text-fog-500 group-hover:text-fog-200"}>
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-ink-700 px-5 py-4">
        <div data-testid="connection-status" className="flex items-center gap-2 text-xs text-fog-400">
          <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} aria-hidden />
          <span className={connection === "error" ? "text-status-dead" : ""}>
            {CONNECTION_LABEL[connection] ?? connection}
          </span>
        </div>
        <p className="mt-1.5 font-mono text-[11px] text-fog-500 tabular-nums">
          {fetchedAt === null ? "awaiting first sync" : `synced ${formatAge(Math.max(0, Math.floor((now - fetchedAt) / 1000)))} ago`}
        </p>
      </div>
    </aside>
  );
}
