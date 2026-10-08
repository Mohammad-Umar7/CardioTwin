import { motion, useIsPresent } from 'framer-motion';
import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Drawer, IconButton, Probability, SegmentedControl, Tabs } from '@/design';
import { tabId, tabPanelId } from '@/design/tabIds';
import { useRiskView } from '@/features/risk/useRiskView';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { explainTakeaway } from '@/lib/explain';
import { formatProbability } from '@/lib/format';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore, type ExplainTab } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { EASE, MOTION } from '@/theme/tokens';
import type { TargetId } from '@/types/contracts';
import { typicalProbability } from './attribution';
import { outsideRange, physiologyTitle, whatIfTitle } from './explainTitles';
import { ModelTab } from './ModelTab';
import { PhraseLink } from './NarrativeSentence';
import { PhysiologyTable } from './PhysiologyTable';
import { useExplainData } from './useExplainData';
import { useExplainTarget } from './useExplainTarget';
import { WhatIfTab } from './WhatIfTab';
import { WhyTab } from './WhyTab';

const TABS: { value: ExplainTab; label: string }[] = [
  { value: 'why', label: 'Why' },
  { value: 'whatif', label: 'What-if' },
  { value: 'physiology', label: 'Physiology' },
  { value: 'model', label: 'Model' },
];

/** Takeaway title per tab (§5.10). Only Why carries the probability: P(target)'s fallback home. */
function DrawerTitle({ id, tab, target }: { id: string; tab: ExplainTab; target: TargetId }) {
  const d = useExplainData(target);
  const view = useRiskView();
  const features = usePatientStore((s) => s.features);
  // While the drawer slides out (AnimatePresence exit), the Risk card is P(target)'s home again: one
  // data-prob per target. Inline (the compact Why tab) there is no exit, so it stays present.
  const present = useIsPresent();
  let body: ReactNode;
  if (tab === 'why') {
    const takeaway = d.index && d.explanation ? explainTakeaway(d.explanation, (k) => d.index!.byKey.get(k)) : null;
    body = d.p ? (
      <>
        {target}{' '}
        <Probability
          p={d.p.probability}
          target={present ? target : undefined}
          size="label"
          stale={d.stale}
          className="text-title-2 [&_.pct-sign]:text-[1em] [&_.pct-sign]:font-semibold [&_.pct-sign]:text-primary"
        />{' '}
        {takeaway ? (
          <>
            {takeaway.verb} <PhraseLink part={takeaway.phrase} className="font-semibold" />
          </>
        ) : (
          'has no single dominant driver'
        )}
      </>
    ) : view.unavailable ? (
      'Explanations appear together with the estimate'
    ) : (
      'Computing the explanation…'
    );
  } else if (tab === 'whatif') {
    body = whatIfTitle(target, view.edits, view.baseline, view.prediction);
  } else if (tab === 'physiology') {
    body = physiologyTitle(d.index ? outsideRange(features, d.index.features).length : 0);
  } else {
    body = 'How this estimate is made';
  }
  return (
    <h2 id={id} className="text-title-2 text-primary">
      {body}
    </h2>
  );
}

export interface ExplainDrawerProps {
  className?: string;
}

/**
 * ExplainDrawer — WORKSTATION_V2 §5.10. Answers "Show me all the evidence". Docked right over the right
 * column (440 / 400 px); the patient card auto-collapses while it is open.
 *
 *   [ CAD | LAD | LCX | RCA ]                                   ✕
 *   CAD 98 % is driven mostly by typical angina                 ← title = takeaway (P(target)'s home here)
 *   A typical cohort patient scores 83 %.
 *   Why   What-if   Physiology   Model
 *
 * The target control calls `select()`, so the camera, rows and inspector follow. Tabs: Why (multimodal
 * fingerprint + raising / lowering inputs, points or log-odds), What-if (recorded vs what-if, your changes,
 * biggest levers), Physiology (reference ranges, findings) and Model (threshold, AUC with CI and n,
 * calibration, what each modality adds, provenance).
 */
export function ExplainDrawer({ className }: ExplainDrawerProps) {
  const open = useUiStore((s) => s.drawer === 'explain');
  const tab = useUiStore((s) => s.explainTab);
  const target = useExplainTarget();
  const d = useExplainData(target);
  const reduced = useIsReducedMotion();
  const titleId = useId();
  const typical = d.scale?.typical ?? typicalProbability(d.explanation);
  const ui = useUiStore.getState;
  const targets = d.index?.targets.map((t) => t.id) ?? ['CAD', 'LAD', 'LCX', 'RCA'];

  return (
    <Drawer
      open={open}
      side="right"
      onClose={() => ui().closeDrawer()}
      labelledBy={titleId}
      region="explain-drawer"
      openerKey="drawer:explain"
      returnFocus='[data-drawer-opener="explain"]'
      className={className}
    >
      <header
        className="shrink-0 border-b border-white/[0.06] bg-[radial-gradient(120%_90%_at_0%_0%,rgba(86,194,230,0.09),transparent_62%)] px-4 pt-3"
        data-tour="why"
      >
        <div className="flex h-7 items-center gap-2">
          <SegmentedControl<TargetId>
            label="Explanation target"
            value={target}
            onChange={(t) => useViewerStore.getState().select(t === 'CAD' ? null : t)}
            options={targets.map((t) => ({ value: t, label: t }))}
          />
          <IconButton label="Close · Esc" icon={<X />} size="sm" className="-mr-1.5 ml-auto" onClick={() => ui().closeDrawer()} />
        </div>
        <div className="mt-3 min-h-[44px]">
          <DrawerTitle id={titleId} tab={tab} target={target} />
          {tab === 'why' && typical !== null && (
            <p className="mt-1 text-label font-normal text-tertiary">
              A typical cohort patient scores {formatProbability(typical).text}
              {target === 'CAD' ? '' : ` for ${target}`}.
            </p>
          )}
        </div>
        <Tabs
          idBase="explain"
          label="Explain sections"
          size="md"
          value={tab}
          onChange={(t) => ui().setExplainTab(t)}
          items={TABS}
          className="-mx-2 mt-3 border-b-0"
        />
      </header>
      <div
        id={tabPanelId('explain', tab)}
        role="tabpanel"
        aria-labelledby={tabId('explain', tab)}
        tabIndex={-1}
        className="panel-scroll min-h-0 flex-1 px-4 pb-6 pt-4 outline-none"
      >
        {/* Fade the new tab in; never an empty frame between tabs (no exit wait). */}
        <motion.div
          key={tab}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : MOTION.base / 1000, ease: EASE.out }}
        >
          {tab === 'why' && <WhyTab target={target} />}
          {tab === 'whatif' && <WhatIfTab target={target} />}
          {tab === 'physiology' && <PhysiologyTable target={target} />}
          {tab === 'model' && <ModelTab target={target} />}
        </motion.div>
      </div>
    </Drawer>
  );
}
