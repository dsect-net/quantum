/**
 * Error boundary — a render crash in one screen never takes the app down.
 * Shows honest copy + a reload affordance and reports to the client logger
 * (visible in developer mode's log viewer).
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { log } from '../lib/logger';

interface Props {
  children: ReactNode;
  /** Screen label for the fallback copy (e.g. "Feed"). */
  scope: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log(
      'boundary',
      `${this.props.scope} crashed: ${error.message} @ ${info.componentStack?.slice(0, 300) ?? 'n/a'}`,
      'error',
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card" role="alert">
          <h2 className="h2">The {this.props.scope} hit a snag</h2>
          <p className="muted small" style={{ marginTop: 8 }}>
            This screen crashed unexpectedly. The error was captured in the
            developer-mode logs. Reloading is safe — nothing was lost.
          </p>
          <p className="mono small dim" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 14 }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
