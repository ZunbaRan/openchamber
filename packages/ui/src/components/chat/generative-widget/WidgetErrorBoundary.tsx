import React from 'react';

interface WidgetErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface WidgetErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Isolates generative-widget crashes so the chat transcript stays usable.
 */
export class WidgetErrorBoundary extends React.Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    console.warn('[WidgetErrorBoundary]', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-muted)] p-3 text-sm">
          <p className="font-medium text-[var(--status-error-foreground)]">
            Widget failed to render
          </p>
          {this.state.error ? (
            <p className="mt-1 text-xs text-muted-foreground">{this.state.error.message}</p>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}
