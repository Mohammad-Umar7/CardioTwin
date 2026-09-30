import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';
import { useUiStore } from '@/state/uiStore';

export const REPOSITORY_URL = 'https://github.com/Mohammad-Umar7/CardioTwin';

/** "Intended use" (DESIGN_SYSTEM §9 "First contact"): below the fold, one scroll away from the hero. */
export function IntendedUseCard() {
  const openDetails = useUiStore((s) => s.openDetails);
  return (
    <article className="flex flex-col gap-2 rounded-lg bg-panel p-5 shadow-e2">
      <h2 className="eyebrow text-tertiary">Intended use</h2>
      <p className="text-body-s text-secondary">
        Education and decision-support research only. <strong className="font-medium text-primary">Not a diagnosis</strong>;
        not a substitute for angiography, CTCA or other formal imaging. Single centre, not externally validated, and the
        cohort's disease prevalence is far higher than in a screening population.
      </p>
      <button
        type="button"
        onClick={openDetails}
        className="self-start rounded-sm text-label font-semibold text-accent hover:text-accent-hover"
      >
        Read the details ›
      </button>
    </article>
  );
}

/** Data & anatomy sources and licences. */
export function DataAnatomyCard() {
  return (
    <article className="flex flex-col gap-2 rounded-lg bg-panel p-5 shadow-e2">
      <h2 className="eyebrow text-tertiary">Data &amp; anatomy</h2>
      <ul className="flex flex-col gap-0.5 text-body-s text-secondary">
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
    </article>
  );
}
