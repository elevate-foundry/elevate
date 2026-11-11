import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: 20,
              color: 'var(--red)',
              background: 'var(--bg)',
              border: '1px solid var(--red)',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Something went wrong
            </div>
            <div style={{ color: 'var(--text-dim)' }}>
              {this.state.error?.message}
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
