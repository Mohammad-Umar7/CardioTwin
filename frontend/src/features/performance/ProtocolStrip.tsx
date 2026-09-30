import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MetricsReport } from '@/types/contracts';
import { ROUTES } from '@/routes';
import { protocolItems, type SplitFacts } from './model';

export function ProtocolStrip({ report, facts }: { report: MetricsReport; facts: SplitFacts }) {
  const items = protocolItems(report, facts);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-4 min-[1440px]:p-5">
      <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-body-s text-secondary md:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-success" />
            <span className="text-pretty">{item}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
        <p className="text-label font-normal text-tertiary">
          Single-centre cohort (n = {report.dataset.n}), not externally validated · decision support and education only,{' '}
          <span className="font-medium text-secondary">not a diagnosis</span>.
        </p>
        <Link to={ROUTES.methodology} className="text-label font-semibold text-accent hover:text-accent-hover">
          Full methodology ›
        </Link>
      </div>
    </div>
  );
}
