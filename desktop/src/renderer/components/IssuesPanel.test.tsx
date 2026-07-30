// @vitest-environment jsdom
// IssuesPanel renders model.issues with sub-account collapse (PARITY
// plugin/tui.ts:538-563). Fixtures mirror buildIssues output
// (plugin/mystatus.ts:7228-7257): ordered error → stale → unconfigured.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MyStatusViewModel, StatusIssue, StatusHealth } from "../../shared/ipc";
import { IssuesPanel } from "./IssuesPanel";

const HOUR = 3_600_000;

function makeModel(issues: StatusIssue[], health?: Partial<StatusHealth>): MyStatusViewModel {
  return {
    summary: { accounts: 1, green: 1, yellow: 0, red: 0 },
    providers: [],
    errors: [],
    alerts: [],
    threshold: 25,
    issues,
    health: {
      queried: 5,
      rendered: 4,
      stale: 1,
      failed: 0,
      unconfigured: 0,
      ...health,
    },
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
});

describe("IssuesPanel — sub-account collapse", () => {
  it("collapses four same-reason stale sub-accounts into one row", () => {
    const issues: StatusIssue[] = [
      { provider: "Google — a@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — b@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — c@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — d@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
    ];
    render(<IssuesPanel model={makeModel(issues, { stale: 4, rendered: 1, queried: 5 })} />);

    const rows = screen.getAllByTestId("issue-row");
    expect(rows).toHaveLength(1);
    const row = screen.getByTestId("issue-row");
    expect(row).toHaveAttribute("data-kind", "stale");
    expect(within(row).getByTestId("issue-provider")).toHaveTextContent("Google (4 accounts)");
    expect(within(row).getByTestId("issue-status")).toHaveTextContent("stale 16h");
  });

  it("keeps distinct failure reasons as separate rows", () => {
    const issues: StatusIssue[] = [
      { provider: "Google — a@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — b@gmail.com", kind: "stale", detail: "404 not found", ageMs: 16 * HOUR },
    ];
    render(<IssuesPanel model={makeModel(issues)} />);
    expect(screen.getAllByTestId("issue-row")).toHaveLength(2);
  });

  it("renders an error row as failed", () => {
    const issues: StatusIssue[] = [{ provider: "xAI/Grok", kind: "error", detail: "401 unauthorized" }];
    render(<IssuesPanel model={makeModel(issues, { failed: 1 })} />);

    const row = screen.getByTestId("issue-row");
    expect(row).toHaveAttribute("data-kind", "error");
    expect(within(row).getByTestId("issue-status")).toHaveTextContent("failed");
  });

  it("shows the all-clear when every configured provider answered live", () => {
    render(<IssuesPanel model={makeModel([])} />);
    expect(screen.getByTestId("issues-empty")).toHaveTextContent("nothing to fix");
    expect(screen.queryByTestId("issue-row")).not.toBeInTheDocument();
  });

  it("renders a compact not-configured list", () => {
    const issues: StatusIssue[] = [
      { provider: "Poe Account Quota", kind: "unconfigured", detail: "no credentials found" },
      { provider: "LongCat API Quota", kind: "unconfigured", detail: "no credentials found" },
    ];
    render(<IssuesPanel model={makeModel(issues, { unconfigured: 2 })} />);
    expect(screen.getByTestId("issues-unconfigured")).toHaveTextContent("Not configured: Poe, LongCat API");
  });
});

describe("IssuesPanel — Credentials routing for cookie providers", () => {
  it("offers a Set up jump for cookie providers and fires the callback", () => {
    const onOpenCredentials = vi.fn();
    const issues: StatusIssue[] = [
      { provider: "LongCat API Quota", kind: "error", detail: "passport token expired" },
    ];
    render(<IssuesPanel model={makeModel(issues, { failed: 1 })} onOpenCredentials={onOpenCredentials} />);

    const setup = screen.getByTestId("issue-setup");
    fireEvent.click(setup);
    expect(onOpenCredentials).toHaveBeenCalledTimes(1);
  });

  it("omits Set up for OAuth / zero-config providers", () => {
    const issues: StatusIssue[] = [{ provider: "Anthropic Account Quota", kind: "error", detail: "boom" }];
    render(<IssuesPanel model={makeModel(issues, { failed: 1 })} onOpenCredentials={vi.fn()} />);
    expect(screen.queryByTestId("issue-setup")).not.toBeInTheDocument();
  });

  it("omits Set up entirely when no navigation callback is provided", () => {
    const issues: StatusIssue[] = [
      { provider: "LongCat API Quota", kind: "error", detail: "passport token expired" },
    ];
    render(<IssuesPanel model={makeModel(issues, { failed: 1 })} />);
    expect(screen.queryByTestId("issue-setup")).not.toBeInTheDocument();
  });
});

describe("IssuesPanel — health line", () => {
  it("reports rendered/queried plus non-zero failure buckets", () => {
    render(<IssuesPanel model={makeModel([], { queried: 5, rendered: 3, failed: 1, stale: 1, unconfigured: 2 })} />);
    expect(screen.getByTestId("issues-health")).toHaveTextContent(
      "3 of 5 providers reporting · 1 failed · 1 stale · 2 not configured",
    );
  });
});
