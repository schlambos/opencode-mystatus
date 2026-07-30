// @vitest-environment jsdom
// SummaryHeader renders MyStatusViewModel.summary verbatim — the fixture below
// mirrors the shape produced by buildMyStatusViewModel (plugin/mystatus.ts:7385-7405).
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SummaryHeader } from "./SummaryHeader";
import type { MyStatusViewModel } from "../../shared/ipc";

const T0 = 1_750_000_000_000;
const FETCHED_AT = T0;
const NEXT_FETCH_AT = T0 + 60_000;
const NOW = T0 + 12_000; // synced 12s ago, 48s until the next poll

function makeFixtureModel(): MyStatusViewModel {
  return {
    summary: {
      accounts: 16,
      green: 8,
      yellow: 3,
      red: 1,
      lowest: { provider: "MiniMax Token Plan", label: "5-hour", remaining: 3 },
      soonest: { provider: "BytePlus Coding Plan", label: "Session", resetMs: 45 * 60 * 1000 },
    },
    providers: [],
    errors: [],
    alerts: [],
    threshold: 25,
    issues: [],
    health: { queried: 5, rendered: 4, stale: 1, failed: 0, unconfigured: 1 },
  };
}

function installBridge(bridge: { refresh?: () => Promise<void> }): void {
  (window as unknown as { mystatus?: unknown }).mystatus = bridge;
}

function removeBridge(): void {
  delete (window as unknown as { mystatus?: unknown }).mystatus;
}

function renderHeader(model: MyStatusViewModel, now: number = NOW) {
  return render(
    <SummaryHeader model={model} fetchedAt={FETCHED_AT} nextFetchAt={NEXT_FETCH_AT} now={now} />,
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  removeBridge();
});

afterEach(() => {
  cleanup();
  removeBridge();
  vi.restoreAllMocks();
});

describe("SummaryHeader", () => {
  it("renders every summary field, the sync cadence, and the health line verbatim", () => {
    renderHeader(makeFixtureModel());

    expect(screen.getByTestId("summary-accounts")).toHaveTextContent("16");

    const tally = screen.getByTestId("summary-tally");
    expect(tally).toHaveTextContent("8");
    expect(tally).toHaveTextContent("3");
    expect(tally).toHaveTextContent("1");
    // Dots are styled spans, never emoji-font glyphs.
    expect(tally.querySelectorAll(".rounded-full")).toHaveLength(3);

    const lowest = screen.getByTestId("summary-lowest");
    expect(lowest).toHaveTextContent("MiniMax Token Plan · 5-hour");
    expect(lowest).toHaveTextContent("3%");
    // 3% < threshold 25 → the "low" tier text token.
    expect(screen.getByText("3%").className).toContain("text-status-low");

    const soonest = screen.getByTestId("summary-soonest");
    expect(soonest).toHaveTextContent("BytePlus Coding Plan · Session");
    // Live countdown: 45m - 12s elapsed = 44m48s → "44m" (tui fmtDur parity).
    expect(screen.getByTestId("soonest-countdown")).toHaveTextContent("44m");

    const sync = screen.getByTestId("summary-sync");
    expect(sync).toHaveTextContent("last synced 12s ago");
    expect(sync).toHaveTextContent("next sync in 48s");

    const health = screen.getByTestId("summary-health");
    expect(health).toHaveTextContent("4/5 reporting");
    expect(health).toHaveTextContent("1 stale");
    expect(health).toHaveTextContent("1 not configured");
    expect(health).not.toHaveTextContent("failed");
  });

  it("invokes the bridge refresh exactly once per press, guarded while in flight", async () => {
    let resolveRefresh: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    installBridge({ refresh });
    renderHeader(makeFixtureModel());

    const button = screen.getByTestId("summary-refresh");
    fireEvent.click(button);
    fireEvent.click(button); // second press while the first is in flight

    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh?.();
    await waitFor(() => expect(screen.getByTestId("summary-refresh")).toBeEnabled());

    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("degrades silently when the preload bridge never loaded", () => {
    removeBridge();
    renderHeader(makeFixtureModel());

    expect(() => fireEvent.click(screen.getByTestId("summary-refresh"))).not.toThrow();
    expect(screen.getByTestId("summary-refresh")).toBeEnabled();
  });

  it("ticks the soonest countdown down as the store clock advances", () => {
    const { rerender } = renderHeader(makeFixtureModel());

    expect(screen.getByTestId("soonest-countdown")).toHaveTextContent("44m");

    rerender(<SummaryHeader model={makeFixtureModel()} fetchedAt={FETCHED_AT} nextFetchAt={NEXT_FETCH_AT} now={T0 + 15 * 60_000 + 12_000} />);
    expect(screen.getByTestId("soonest-countdown")).toHaveTextContent("29m");

    // Past the reset moment the countdown reads "now", not a negative duration.
    rerender(<SummaryHeader model={makeFixtureModel()} fetchedAt={FETCHED_AT} nextFetchAt={NEXT_FETCH_AT} now={T0 + 46 * 60_000} />);
    expect(screen.getByTestId("soonest-countdown")).toHaveTextContent("now");
  });

  it("colors the lowest percentage with the plugin tier tokens", () => {
    const model = makeFixtureModel();
    model.summary.lowest = { provider: "Google", label: "Gemini Pro", remaining: 0 };
    renderHeader(model);
    expect(screen.getByText("0%").className).toContain("text-status-dead");
    cleanup();

    model.summary.lowest = { provider: "Ollama Cloud", label: "Session", remaining: 99 };
    renderHeader(model);
    expect(screen.getByText("99%").className).toContain("text-status-ok");
  });

  it("degrades without NaN/undefined text when lowest and soonest are absent", () => {
    const model = makeFixtureModel();
    model.summary = { accounts: 2, green: 0, yellow: 0, red: 2 }; // every provider errored
    model.health = { queried: 2, rendered: 0, stale: 0, failed: 2, unconfigured: 0 };

    const { container } = renderHeader(model);

    expect(screen.getByTestId("summary-lowest")).toHaveTextContent("No windows reported.");
    expect(screen.getByTestId("summary-soonest")).toHaveTextContent("No upcoming resets reported.");
    expect(screen.queryByTestId("soonest-countdown")).toBeNull();

    const health = screen.getByTestId("summary-health");
    expect(health).toHaveTextContent("0/2 reporting");
    expect(health).toHaveTextContent("2 failed");
    expect(health).not.toHaveTextContent("stale");
    expect(health).not.toHaveTextContent("not configured");

    expect(container.textContent ?? "").not.toMatch(/NaN|undefined/);
  });

  it("hides the health line when nothing failed, went stale, or is unconfigured", () => {
    const model = makeFixtureModel();
    model.health = { queried: 4, rendered: 4, stale: 0, failed: 0, unconfigured: 0 };

    renderHeader(model);

    expect(screen.queryByTestId("summary-health")).toBeNull();
  });
});
