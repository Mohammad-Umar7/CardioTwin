import { useEffect, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { DrawerPresentation, Tabs } from '@/design';
import { tabPanelId } from '@/design/tabIds';
import { useCohort } from '@/hooks/useData';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { ExplainDrawer } from '@/features/explain/ExplainDrawer';
import { InputsDrawer } from '@/features/patient/InputsDrawer';
import { PatientCard } from '@/features/patient/PatientCard';
import { usePatientCommands } from '@/features/patient/usePatientCommands';
import { useShareLinkRestore } from '@/features/patient/useShareLinkRestore';
import { WhatIfPill } from '@/features/patient/WhatIfPill';
import { AnswerPill } from '@/features/risk/AnswerPill';
import { RiskSummaryCard } from '@/features/risk/RiskSummaryCard';
import { VesselInspector } from '@/features/risk/VesselInspector';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore, type MobileTab } from '@/state/uiStore';
import { CanvasSlot } from '@/three/CanvasSlot';
import { CanvasToolbar } from './hud/CanvasToolbar';
import { FirstRunHint } from './hud/FirstRunHint';
import { LegendChip } from './hud/LegendChip';
import { SelectionChip } from './hud/SelectionChip';
import { ChromeGate, StageLayout } from './StageLayout';
import { useWorkstationCommands } from './useWorkstationCommands';
import { useWorkstationUrlState } from './useWorkstationUrlState';

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

/**
 * The workstation always opens with workstation chrome (the landing page sets `landing`), and focus mode
 * never outlives the page: leaving the route restores the workstation preset.
 */
function useWorkstationChrome() {
  useEffect(() => {
    const ui = useUiStore.getState();
    if (ui.chrome === 'landing') ui.setChrome('workstation');
    return () => {
      if (useUiStore.getState().chrome === 'focus') useUiStore.getState().setChrome('workstation');
    };
  }, []);
}

function PageTitle() {
  const id = usePatientStore((s) => s.selectedPatientId);
  const mode = usePatientStore((s) => s.mode);
  const who = mode === 'custom' ? 'custom patient' : mode === 'blank' ? 'blank patient' : (id ?? 'no patient selected');
  return <h1 className="sr-only">Workstation · {who}</h1>;
}

const FOCUS_ONLY = ['focus'] as const;

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
            <ChromeGate hideIn={FOCUS_ONLY}>
              <RiskSummaryCard />
            </ChromeGate>
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

// ----------------------------------------------------------------------------------------- compact

/** Below 1100 px the cards fill the column (V2 §4.7): the owners size them with these variables. */
const COMPACT_VARS = { '--card-left-w': '100%', '--card-right-w': '100%' } as CSSProperties;

const COMPACT_TABS: { value: MobileTab; label: string }[] = [
  { value: 'risk', label: 'Summary' },
  { value: 'inputs', label: 'Record' },
  { value: 'why', label: 'Why' },
];

/**
 * Compact workstation, below 1100 px (WORKSTATION_V2 §4.7): the canvas takes 50vh at the top with the
 * floating toolbar and the context chips; under it, tabs: Summary (Risk card, then the inspector inline),
 * Record (the patient card) and Why (the Explain drawer's content inline). The Inputs drawer becomes a
 * full-screen sheet; "Explain" (E, or the card's button) switches to the Why tab instead of a sheet, so
 * P(CAD) never has two homes.
 */
function CompactWorkstation() {
  const tab = useUiStore((s) => s.panels.mobileTab);
  const drawer = useUiStore((s) => s.drawer);
  const setPanels = useUiStore((s) => s.setPanels);
  const edits = usePatientStore(selectEditCount);
  const chrome = useUiStore((s) => s.chrome);

  // Focus mode has no meaning in the stacked layout (nothing floats over the stage).
  useEffect(() => {
    if (chrome === 'focus') useUiStore.getState().setChrome('workstation');
  }, [chrome]);

  useEffect(() => {
    if (drawer !== 'explain') return;
    const ui = useUiStore.getState();
    ui.setPanels({ mobileTab: 'why' });
    ui.closeDrawer();
    document.getElementById(tabPanelId('compact', 'why'))?.scrollIntoView({ block: 'start' });
  }, [drawer]);

  return (
    <div className="flex flex-col" style={COMPACT_VARS} data-region="compact">
      <PageTitle />
      <div className="relative h-[50vh] min-h-[320px] shrink-0">
        <StageLayout
          canvas={<CanvasSlot stage="workstation" className="h-full w-full" />}
          top={
            <>
              <SelectionChip />
              <WhatIfPill />
            </>
          }
          bottom={<CanvasToolbar compact />}
          overlay={<FirstRunHint />}
          frame={edits > 0}
        />
      </div>
      <Tabs
        idBase="compact"
        label="Workstation sections"
        value={tab}
        onChange={(mobileTab: MobileTab) => setPanels({ mobileTab })}
        size="md"
        className="sticky top-[var(--topbar-h)] z-panels bg-app px-3"
        items={COMPACT_TABS}
      />
      <div
        id={tabPanelId('compact', tab)}
        role="tabpanel"
        aria-labelledby={`compact-tab-${tab}`}
        className="flex flex-col gap-[var(--card-gap)] px-3 py-3"
      >
        {tab === 'risk' && (
          <>
            <RiskSummaryCard />
            <VesselInspector />
          </>
        )}
        {tab === 'inputs' && <PatientCard />}
        {tab === 'why' && (
          <DrawerPresentation mode="inline">
            <div className="stage-card">
              <ExplainDrawer />
            </div>
          </DrawerPresentation>
        )}
      </div>
      <DrawerPresentation mode="sheet">
        <InputsDrawer />
      </DrawerPresentation>
    </div>
  );
}

/**
 * Workstation route: the V2 stage at every desktop width (≥ 1100), the V2 compact layout below 1100.
 * Page-level hooks live here, not in a card, so they survive the card being collapsed, hidden by focus
 * mode or swapped out by the compact tabs: the palette's patient and input commands, the share-link
 * restore, the URL state and the chrome preset.
 */
export default function WorkstationPage() {
  const mode = useLayoutMode();
  useWorkstationCommands();
  usePatientCommands();
  useShareLinkRestore();
  usePatientFromRoute();
  useWorkstationUrlState();
  useWorkstationChrome();

  return mode === 'compact' ? <CompactWorkstation /> : <StageWorkstation />;
}
