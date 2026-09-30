import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Divider, Panel, SectionHeader, Tabs } from '@/design';
import { tabPanelId } from '@/design/tabIds';
import { cn } from '@/lib/cn';
import { ExplainPanel, TopDrivers } from '@/features/explain/ExplainPanel';
import { PhysiologyTable } from '@/features/explain/PhysiologyTable';
import { useExplainTarget } from '@/features/explain/useExplainTarget';
import { ClinicalForm } from '@/features/patient/ClinicalForm';
import { PatientPicker } from '@/features/patient/PatientPicker';
import { PatientModeSwitch, WhatIfBar } from '@/features/patient/WhatIfBar';
import { CADHeroCard } from '@/features/risk/CADHeroCard';
import { GroundTruthReveal } from '@/features/risk/GroundTruthReveal';
import { VesselList } from '@/features/risk/VesselList';
import { useUiStore, type RightTab } from '@/state/uiStore';

/** Patient header shared by the wide left panel, the rail flyout and the compact Inputs tab. */
export function PatientHeader() {
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-3 pt-4">
      <SectionHeader title="Patient" aside={<PatientModeSwitch />} />
      <PatientPicker />
      <WhatIfBar />
    </div>
  );
}

/** ≥ 1440 left panel: patient header + every schema group as an accordion (DESIGN_SYSTEM §4.2). */
export function LeftPanel() {
  return (
    <Panel as="aside" aria-label="Patient inputs" className="flex min-h-0 flex-col border-r border-hairline">
      <PatientHeader />
      <div className="panel-scroll min-h-0 flex-1" data-tour="inputs">
        <ClinicalForm />
      </div>
    </Panel>
  );
}

function PhysiologySection() {
  const target = useExplainTarget();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="physiology-title" className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-sm text-left"
      >
        <ChevronRight aria-hidden className={cn('size-4 text-tertiary transition-transform duration-fast', open && 'rotate-90')} />
        <h2 id="physiology-title" className="overline text-secondary">
          Physiology
        </h2>
        <span className="ml-auto text-label font-normal text-tertiary">value · ref · SHAP ({target})</span>
      </button>
      {open && <PhysiologyTable target={target} />}
    </section>
  );
}

/** ≥ 1440 right panel: CAD card pinned, then vessels, reveal, WHY and physiology in a scroll area. */
export function RightPanel() {
  return (
    <Panel as="aside" aria-label="Risk and explanation" className="flex min-h-0 flex-col border-l border-hairline">
      <div id="risk-summary" tabIndex={-1} className="border-b border-hairline px-4 pb-4 pt-4 outline-none animate-rise-in">
        <CADHeroCard />
      </div>
      <div className="panel-scroll flex min-h-0 flex-1 flex-col gap-5 px-4 py-4">
        <div className="flex flex-col gap-3 animate-rise-in [animation-delay:40ms]">
          <VesselList />
          <GroundTruthReveal />
        </div>
        <Divider />
        <div className="animate-rise-in [animation-delay:80ms]">
          <ExplainPanel />
        </div>
        <Divider />
        <PhysiologySection />
      </div>
    </Panel>
  );
}

/** 1100–1439 right panel: tabs Risk / Why / Physiology; the Risk tab keeps a top-drivers teaser. */
export function TabbedRightPanel() {
  const tab = useUiStore((s) => s.panels.rightTab);
  const setPanels = useUiStore((s) => s.setPanels);
  const target = useExplainTarget();
  const setTab = (rightTab: RightTab) => setPanels({ rightTab });
  return (
    <Panel as="aside" aria-label="Risk and explanation" className="flex min-h-0 flex-col border-l border-hairline">
      <Tabs
        idBase="right"
        label="Results"
        value={tab}
        onChange={setTab}
        size="md"
        className="px-3 pt-1"
        items={[
          { value: 'risk', label: 'Risk' },
          { value: 'why', label: 'Why' },
          { value: 'physiology', label: 'Physiology' },
        ]}
      />
      <div
        id={tabPanelId('right', tab)}
        role="tabpanel"
        aria-labelledby={`right-tab-${tab}`}
        className="panel-scroll flex min-h-0 flex-1 flex-col gap-4 px-4 py-3"
      >
        {tab === 'risk' && (
          <>
            <div id="risk-summary" tabIndex={-1} className="outline-none">
              <CADHeroCard />
            </div>
            <Divider />
            <VesselList />
            <GroundTruthReveal />
            <Divider />
            <TopDrivers onMore={() => setTab('why')} />
          </>
        )}
        {tab === 'why' && <ExplainPanel idBase="why-tab" />}
        {tab === 'physiology' && <PhysiologyTable target={target} />}
      </div>
    </Panel>
  );
}
