import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col items-start justify-center gap-3 px-6 py-20">
      <p className="overline text-tertiary">404</p>
      <h1 className="font-display text-display-2 text-primary">This view does not exist.</h1>
      <p className="text-body text-secondary">The link may be outdated. The workstation opens on a held-out test patient.</p>
      <div className="flex gap-4 text-body-s font-semibold">
        <Link to={ROUTES.workstation} className="text-accent hover:text-accent-hover">
          Open workstation →
        </Link>
        <Link to={ROUTES.landing} className="text-secondary hover:text-primary">
          Home
        </Link>
      </div>
    </div>
  );
}
