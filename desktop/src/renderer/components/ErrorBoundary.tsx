import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last line of defence: any render-tree exception becomes a recoverable
 * panel instead of a white screen. Payload-level problems never reach here
 * (the store rejects them), so this only catches genuine component bugs.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[mystatus] renderer crash:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        data-testid="error-boundary"
        className="mx-auto my-16 max-w-lg rounded-lg border border-status-dead/40 bg-status-dead/10 p-6"
      >
        <p className="text-[10px] font-semibold tracking-[0.2em] text-status-dead uppercase">
          Renderer fault
        </p>
        <h2 className="mt-2 text-lg font-semibold text-fog-100">Something broke while drawing this pane</h2>
        <pre className="mt-3 overflow-x-auto rounded-md bg-ink-950/80 p-3 font-mono text-xs text-fog-400">
          {error.message}
        </pre>
        <p className="mt-3 text-sm text-fog-400">
          Your quota data is untouched. Reloading the window recovers the shell.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md border border-ink-600 bg-ink-800 px-4 py-2 text-sm font-medium text-fog-100 transition-colors hover:border-accent/60 hover:text-accent"
        >
          Reload window
        </button>
      </div>
    );
  }
}
