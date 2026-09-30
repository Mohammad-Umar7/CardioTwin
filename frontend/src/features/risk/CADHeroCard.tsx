import { CadHeadline } from './CadHeadline';

/**
 * Legacy mount of the CAD answer, kept only for the pre-V2 layouts (`?layout=legacy` and the < 1100 px stack)
 * until the integration pass deletes them. It renders the V2 headline (numeral + band chip, threshold track
 * without scale numerals, verdict in the §3.2 vocabulary): the meter, the "0 / thr / 100" scale and the
 * "Model estimate, not a diagnosis" microcopy are gone (the header tag carries it).
 */
export function CADHeroCard() {
  return (
    <section aria-labelledby="cad-card-title" className="flex flex-col" data-tour="cad-card">
      <CadHeadline titleId="cad-card-title" />
    </section>
  );
}
