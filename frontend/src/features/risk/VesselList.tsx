import { useSchemaIndex } from '@/hooks/useData';
import { useRiskView } from './useRiskView';
import { VesselRows } from './VesselRows';
import { flaggedCount } from './verdict';

/**
 * Legacy mount of the vessel rows (pre-V2 layouts only, until the integration pass deletes them): the V2
 * rows with "k of 3 flagged". The "≈ 1.7 of 3 expected" line moved to Explain › Model (§3.2); the chevron and
 * the band word on the rows are gone.
 */
export function VesselList() {
  const index = useSchemaIndex();
  const view = useRiskView();
  const count = flaggedCount(view.prediction, (index?.vessels ?? []).map((v) => v.id));
  return (
    <section aria-labelledby="vessels-title" className="flex flex-col gap-1">
      <div className="flex h-6 items-center justify-between">
        <h3 id="vessels-title" className="eyebrow text-secondary">
          Vessels
        </h3>
        {count && <span className="text-label font-normal text-secondary">{view.stale ? 'Updating' : count.text}</span>}
      </div>
      <VesselRows />
    </section>
  );
}
