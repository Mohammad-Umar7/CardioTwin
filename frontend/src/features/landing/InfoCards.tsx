import { ArrowUpRight, ExternalLink, Library, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';
import { useUiStore } from '@/state/uiStore';

export const REPOSITORY_URL = 'https://github.com/Mohammad-Umar7/CardioTwin';

/** LUMEN 2 reading card: lit glyph, overline, body; it rises into view once (useReveal). */
function InfoCard({ icon, title, children, delay = 0 }: { icon: ReactNode; title: string; children: ReactNode; delay?: number }) {
  return (
    <article
      data-reveal
      style={{ ['--reveal-delay' as string]: `${delay}ms` }}
      className="card-surface spotlight flex flex-col gap-3 p-6"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-md bg-[linear-gradient(145deg,rgba(86,194,230,0.16),rgba(129,140,248,0.06))] text-accent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] [&>svg]:size-4 [&>svg]:stroke-[1.75]"
        >
          {icon}
        </span>
        <h2 className="eyebrow text-secondary">{title}</h2>
      </div>
      {children}
    </article>
  );
}

/** "Intended use" (DESIGN_SYSTEM §9 "First contact"): below the fold, one scroll away from the hero. */
export function IntendedUseCard() {
  const openDetails = useUiStore((s) => s.openDetails);
  return (
    <InfoCard icon={<ShieldAlert />} title="Intended use">
      <p className="text-body-s text-secondary">
        Education and decision-support research only. <strong className="font-medium text-primary">Not a diagnosis</strong>;
        not a substitute for angiography, CTCA or other formal imaging. Single centre, not externally validated, and the
        cohort's disease prevalence is far higher than in a screening population.
      </p>
      <button
        type="button"
        onClick={openDetails}
        className="group/link inline-flex items-center gap-1 self-start rounded-sm text-label font-semibold text-accent hover:text-accent-hover"
      >
        Read the details
        <ArrowUpRight aria-hidden className="size-3.5 stroke-[2] transition-transform duration-fast group-hover/link:-translate-y-px group-hover/link:translate-x-px" />
      </button>
    </InfoCard>
  );
}

/** Data & anatomy sources and licences. */
export function DataAnatomyCard() {
  return (
    <InfoCard icon={<Library />} title="Data & anatomy" delay={90}>
      <ul className="flex flex-col gap-1 text-body-s text-secondary">
        <li>Extension of Z-Alizadeh Sani, UCI #411 · CC BY 4.0</li>
        <li>BodyParts3D © DBCLS · CC BY-SA 2.1 JP</li>
      </ul>
      <div className="flex gap-4 text-label font-semibold">
        <span className="text-tertiary">Code MIT</span>
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-accent hover:text-accent-hover"
        >
          GitHub <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <Link to={`${ROUTES.methodology}#model-card`} className="rounded-sm text-accent hover:text-accent-hover">
          Model card ›
        </Link>
      </div>
    </InfoCard>
  );
}
