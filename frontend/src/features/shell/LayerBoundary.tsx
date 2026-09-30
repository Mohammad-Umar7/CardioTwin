import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';

interface LayerBoundaryProps {
  /** Name for the console message ("tour", "palette", "route"). */
  name: string;
  /** Rendered instead of the children after an error (default: nothing). */
  fallback?: ReactNode;
  /** Called once per caught error, e.g. to close the overlay that failed. */
  onError?(error: unknown): void;
  /** A change of this value clears the error (the overlay was closed, the route changed). */
  resetKey?: unknown;
  children: ReactNode;
}

/**
 * Keeps one failing layer (guided demo, palette, shortcut sheet, a routed page) from unmounting the whole
 * app: the layer is replaced by `fallback`, `onError` puts the app back in a sane state (e.g. ends the
 * demo), and the next `resetKey` change lets the layer render again.
 */
export class LayerBoundary extends Component<LayerBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[${this.props.name}] layer failed and was closed`, error, info.componentStack);
    this.props.onError?.(error);
  }

  override componentDidUpdate(prev: LayerBoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/** What a routed page shows if it throws: the shell (top bar, status line) stays, with a way on. */
export function RouteErrorFallback() {
  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-1 flex-col items-start justify-center gap-3 px-6 py-20">
      <p className="eyebrow text-tertiary">Something went wrong</p>
      <h1 className="font-display text-display-2 text-primary">This view hit an error.</h1>
      <p className="text-body text-secondary">
        No estimate is shown while it is broken. Reload the page, or open the workstation again.
      </p>
      <div className="flex gap-4 text-body-s font-semibold">
        <button type="button" onClick={() => window.location.reload()} className="text-accent hover:text-accent-hover">
          Reload
        </button>
        <Link to={ROUTES.workstation} className="text-secondary hover:text-primary">
          Open workstation →
        </Link>
      </div>
    </div>
  );
}
