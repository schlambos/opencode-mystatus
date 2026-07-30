import type { ReactNode, JSX } from "react";

interface PaneShellProps {
  testId: string;
  kicker: string;
  title: string;
  children: ReactNode;
}

/** Shared pane chrome: tiny uppercase kicker, title, body. */
export function PaneShell({ testId, kicker, title, children }: PaneShellProps): JSX.Element {
  return (
    <div data-testid={testId} className="mx-auto max-w-5xl px-8 py-9">
      <p className="text-[10px] font-semibold tracking-[0.24em] text-fog-500 uppercase">{kicker}</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-fog-100">{title}</h1>
      <div className="mt-7">{children}</div>
    </div>
  );
}
