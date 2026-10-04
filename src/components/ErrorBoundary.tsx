import { Component, type ReactNode } from "react";

/** Shows what went wrong instead of a blank page, with a way out. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="center">
        <h2>Something went wrong</h2>
        <p className="error pre">{error.message}</p>
        <p className="muted small">Build {__APP_VERSION__}</p>
        <div className="row">
          <button onClick={() => location.reload()}>Reload</button>
          <button onClick={() => (location.href = "/")}>Back to your games</button>
        </div>
      </main>
    );
  }
}
