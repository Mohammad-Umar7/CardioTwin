import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Tabs } from '@/design';
import { tabPanelId } from '@/design/tabIds';
import { useCohort } from '@/hooks/useData';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { ExplainDrawer } from '@/features/explain/ExplainDrawer';
import { ExplainPanel } from '@/features/explain/ExplainPanel';
import { ClinicalForm } from '@/features/patient/ClinicalForm';
import { InputsDrawer } from '@/features/patient/InputsDrawer';
import { PatientCard } from '@/features/patient/PatientCard';
import { WhatIfPill } from '@/features/patient/WhatIfPill';
import { AnswerPill } from '@/features/risk/AnswerPill';
import { CADHeroCard } from '@/features/risk/CADHeroCard';
import { GroundTruthReveal } from '@/features/risk/GroundTruthReveal';
import { RiskSummaryCard } from '@/features/risk/RiskSummaryCard';
import { VesselInspector } from '@/features/risk/VesselInspector';
import { VesselList } from '@/features/risk/VesselList';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore, type MobileTab } from '@/state/uiStore';
import { CanvasSlot } from '@/three/CanvasSlot';
import { CanvasHud } from './CanvasHud';
import { GroupRail } from './GroupRail';
import { CanvasToolbar } from './hud/CanvasToolbar';
import { FirstRunHint } from './hud/FirstRunHint';
import { LegendChip } from './hud/LegendChip';
import { SelectionChip } from './hud/SelectionChip';
import { LeftPanel, PatientHeader, RightPanel, TabbedRightPanel } from './panels';
import { StageLayout } from './StageLayout';
import { useWorkstationCommands } from './useWorkstationCommands';

/** Deep link: #/workstation/P-017 opens that cohort patient. */
function usePatientFromRoute() {
  const { patientId } = useParams();
  const cohort = useCohort();
  useEffect(() => {
    if (!patientId || !cohort.data) return;
    const patient = cohort.data.patients.find((p) => p.id.toLowerCase() === patientId.toLowerCase());
    if (patient && usePatientStore.getState().selectedPatientId !== patient.id) usePatientStore.getState().loadPatient(patient);
  }, [patientId, cohort.data]);
}

/** The workstation always opens with workstation chrome (the landing page sets `landing`). */
function useWorkstationChrome() {
  useEffect(() => {
    const ui = useUiStore.getState();
    if (ui.chrome === 'landing') ui.setChrome('workstation');
  }, []);
}

function PageTitle() {
  const id = usePatientStore((s) => s.selectedPatientId);
  const mode = usePatientStore((s) => s.mode);
  const who = mode === 'custom' ? 'custom patient' : mode === 'blank' ? 'blank patient' : (id ?? 'no patient selected');
  return <h1 className="sr-only">Workstation · {who}</h1>;
}

/**
 * V2 workstation (WORKSTATION_V2 §4): the full-bleed stage with floating cards. The slot contents are the
 * owners' components (B patient, C risk/explain, D hud); StageLayout places them and publishes the insets.
 */
function StageWorkstation() {
  const edits = usePatientStore(selectEditCount);
  return (
    <div className="relative min-h-0" style={{ height: 'calc(100vh - var(--topbar-h) - var(--status-h))' }}>
      <PageTitle />
      <StageLayout
        canvas={<CanvasSlot stage="workstation" className="h-full w-full" />}
        left={<PatientCard />}
        right={
          <>
            <RiskSummaryCard />
            <VesselInspector />
          </>
        }
        top={
          <>
            <SelectionChip />
            <WhatIfPill />
          </>
        }
        bottom={<CanvasToolbar />}
        bottomLeft={<LegendChip />}
        overlay={
          <>
            <AnswerPill />
            <FirstRunHint />
          </>
        }
        drawers={
          <>
            <InputsDrawer />
            <ExplainDrawer />
          </>
        }
        frame={edits > 0}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ legacy
// The phase-1 layouts stay reachable at #/workstation?layout=legacy (and below 1100 px) until B–D replace
// the panels; then GroupRail, panels.tsx and CanvasHud are deleted (V2 §9.3).

function LegacyCanvasStage({ className }: { className?: string }) {
  return (
    <CanvasSlot stage="workstation" className={className}>
      <CanvasHud />
    </CanvasSlot>
  );
}

function CompactTabs() {
  const tab = useUiStore((s) => s.panels.mobileTab);
  const setPanels = useUiStore((s) => s.setPanels);
  return (
    <div className="flex flex-col">
      <Tabs
        idBase="compact"
        label="Workstation sections"
        value={tab}
        onChange={(mobileTab: MobileTab) => setPanels({ mobileTab })}
        size="md"
        className="sticky top-0 z-panels bg-panel px-3"
        items={[
          { value: 'inputs', label: 'Inputs' },
          { value: 'risk', label: 'Risk' },
          { value: 'why', label: 'Why' },
        ]}
      />
      <div id={tabPanelId('compact', tab)} role="tabpanel" aria-labelledby={`compact-tab-${tab}`} className="bg-panel">
        {tab === 'inputs' && (
          <>
            <PatientHeader />
            <ClinicalForm />
          </>
        )}
        {tab === 'risk' && (
          <div id="risk-summary" tabIndex={-1} className="flex flex-col gap-4 px-4 py-4 outline-none">
            <CADHeroCard />
            <VesselList />
            <GroundTruthReveal />
          </div>
        )}
        {tab === 'why' && (
          <div className="px-4 py-4">
            <ExplainPanel idBase="why-compact" />
          </div>
        )}
      </div>
    </div>
  );
}

function LegacyWorkstation({ wide }: { wide: boolean }) {
  return (
    <div
      className="relative grid min-h-0 overflow-clip"
      style={{
        height: 'calc(100vh - var(--topbar-h) - var(--status-h))',
        gridTemplateColumns: wide
          ? 'var(--left-w) minmax(0, 1fr) var(--right-w)'
          : 'var(--group-rail-w) minmax(0, 1fr) var(--right-w)',
      }}
    >
      <PageTitle />
      {wide ? <LeftPanel /> : <GroupRail />}
      <LegacyCanvasStage className="min-h-0" />
      {wide ? <RightPanel /> : <TabbedRightPanel />}
    </div>
  );
}

/**
 * Workstation route. Desktop (≥ 1100): the V2 stage. Below 1100: the stacked compact layout (canvas on
 * top, tabs below) until the V2 compact layout lands. `?layout=legacy` shows the phase-1 3-column grid.
 */
export default function WorkstationPage() {
  const mode = useLayoutMode();
  const [params] = useSearchParams();
  useWorkstationCommands();
  usePatientFromRoute();
  useWorkstationChrome();

  if (mode === 'compact') {
    return (
      <div className="flex flex-col">
        <PageTitle />
        <LegacyCanvasStage className="h-[55vh] min-h-[320px]" />
        <CompactTabs />
      </div>
    );
  }
  if (params.get('layout') === 'legacy') return <LegacyWorkstation wide={mode === 'wide'} />;
  return <StageWorkstation />;
}
