import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';

export function NotFoundPage() {
  return (
    <div className="page-enter mx-auto flex max-w-xl flex-1 flex-col items-start justify-center gap-4 px-6 py-20">
      <p className="eyebrow inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1 text-tertiary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <span aria-hidden className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(86,194,230,0.9)]" />
        404
      </p>
      <h1 className="text-gradient pb-1 font-display text-display-2">This view does not exist.</h1>
      <p className="text-body text-secondary">The link may be outdated. The workstation opens on a held-out test patient.</p>
      <div className="flex items-center gap-5 text-body-s font-semibold">
        <Link to={ROUTES.workstation} className="group/nf inline-flex items-center gap-1.5 text-accent hover:text-accent-hover">
          Open workstation
          <ArrowRight aria-hidden className="size-4 stroke-[2] transition-transform duration-fast group-hover/nf:translate-x-0.5" />
        </Link>
        <Link to={ROUTES.landing} className="text-secondary hover:text-primary">
          Home
        </Link>
      </div>
    </div>
  );
}
