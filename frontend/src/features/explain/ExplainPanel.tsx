import { SectionHeader } from '@/design';
import { tabPanelId } from '@/design/tabIds';
import { NarrativeSentence } from './NarrativeSentence';
import { ShapWaterfall } from './ShapWaterfall';
import { TargetTabs } from './TargetTabs';
import { useExplainTarget } from './useExplainTarget';

/**
 * @deprecated Pre-V2 right-panel WHY section, kept only for `features/workstation/panels.tsx` and the < 1100 px
 * stack until the integration pass deletes them; the V2 home of this content is the Explain drawer.
 *
 * WHY section (DESIGN_SYSTEM §4.2 right panel): target tabs synced with the 3D selection, the narrative
 * sentence first, then the SHAP waterfall with the "typical → this patient" footer.
 */
export function ExplainPanel({ idBase = 'why' }: { idBase?: string }) {
  const target = useExplainTarget();
  return (
    <section aria-labelledby={`${idBase}-title`} className="flex flex-col gap-2.5" data-tour="why">
      <div className="flex items-end justify-between gap-2">
        <SectionHeader id={`${idBase}-title`} title="Why" className="pb-1" />
        <TargetTabs idBase={idBase} />
      </div>
      <div id={tabPanelId(idBase, target)} role="tabpanel" aria-labelledby={`${idBase}-tab-${target}`} className="flex flex-col gap-3">
        <NarrativeSentence target={target} />
        <ShapWaterfall target={target} />
      </div>
    </section>
  );
}

/**
 * @deprecated Removed by WORKSTATION_V2 §9.3 C; kept only for the legacy `panels.tsx` until it is deleted.
 * Risk-tab teaser (1280 layout): top 4 drivers so the answer and its explanation are one click apart.
 */
export function TopDrivers({ onMore }: { onMore?: () => void }) {
  const target = useExplainTarget();
  return (
    <section aria-labelledby="drivers-title" className="flex flex-col gap-1.5">
      <SectionHeader
        id="drivers-title"
        title={`Top drivers · ${target}`}
        aside={
          onMore && (
            <button type="button" onClick={onMore} className="rounded-sm text-label font-semibold text-accent hover:text-accent-hover">
              Why ›
            </button>
          )
        }
      />
      <ShapWaterfall target={target} limit={4} compact />
    </section>
  );
}
