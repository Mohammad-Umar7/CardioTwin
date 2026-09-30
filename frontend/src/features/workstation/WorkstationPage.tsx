import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Tabs } from '@/design';
import { tabPanelId } from '@/design/tabIds';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { ExplainPanel } from '@/features/explain/ExplainPanel';
import { ClinicalForm } from '@/features/patient/ClinicalForm';
import { CADHeroCard } from '@/features/risk/CADHeroCard';
import { GroundTruthReveal } from '@/features/risk/GroundTruthReveal';
import { VesselList } from '@/features/risk/VesselList';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore, type MobileTab } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { CanvasSlot } from '@/three/CanvasSlot';
import { PROJECTIONS, cycleProjection } from '@/three/camera/presets';
import { CanvasHud } from './CanvasHud';
import { GroupRail } from './GroupRail';
import { LeftPanel, PatientHeader, RightPanel, TabbedRightPanel } from './panels';

/** Workstation shortcuts (DESIGN_SYSTEM §10.3). Arrow keys / zoom live on the focused canvas itself. */
function useWorkstationHotkeys() {
  const index = useSchemaIndex();
  useHotkeys({
    '1': () => index?.vessels[0] && useViewerStore.getState().select(index.vessels[0].id),
    '2': () => index?.vessels[1] && useViewerStore.getState().select(index.vessels[1].id),
    '3': () => index?.vessels[2] && useViewerStore.getState().select(index.vessels[2].id),
    '0': () => useViewerStore.getState().flyHome(),
    h: () => useViewerStore.getState().flyHome(),
    Escape: () => useViewerStore.getState().select(null),
    b: () => useViewerStore.getState().toggle('heartbeat'),
    t: () => useViewerStore.getState().toggle('territories'),
    f: () => useViewerStore.getState().toggle('bloodFlow'),
    '[': () => {
      const v = useViewerStore.getState();
      v.flyToPreset(cycleProjection(lastPreset(), -1).id);
    },
    ']': () => {
      const v = useViewerStore.getState();
      v.flyToPreset(cycleProjection(lastPreset(), 1).id);
    },
  });
}

const lastPreset = () => {
  const cmd = useViewerStore.getState().cameraCommand;
  return cmd?.kind === 'preset' && cmd.preset && PROJECTIONS.some((p) => p.id === cmd.preset) ? cmd.preset : null;
};

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

function CanvasStage({ className }: { className?: string }) {
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

/**
 * Workstation (DESIGN_SYSTEM §4.2–4.3). Layout by viewport:
 *   ≥ 1440      320 inputs panel · fluid canvas · 384 results panel (CAD card pinned)
 *   1100–1439   56 rail + 296 flyout OVER the canvas · fluid canvas · tabbed results panel
 *   < 1100      canvas 55vh on top, tabs Inputs / Risk / Why below
 * Panels read the stores; the canvas is the persistent shell canvas moved into this page's slot.
 */
function PageTitle() {
  const id = usePatientStore((s) => s.selectedPatientId);
  const mode = usePatientStore((s) => s.mode);
  return <h1 className="sr-only">Workstation · {mode === 'custom' ? 'custom patient' : (id ?? 'no patient selected')}</h1>;
}

export default function WorkstationPage() {
  const mode = useLayoutMode();
  useWorkstationHotkeys();
  usePatientFromRoute();

  if (mode === 'compact') {
    return (
      <div className="flex flex-col">
        <PageTitle />
        <CanvasStage className="h-[55vh] min-h-[320px]" />
        <CompactTabs />
      </div>
    );
  }

  return (
    <div
      className="relative grid min-h-0 overflow-hidden"
      style={{
        height: 'calc(100vh - var(--topbar-h) - var(--status-h))',
        gridTemplateColumns: mode === 'wide' ? 'var(--left-w) minmax(0, 1fr) var(--right-w)' : 'var(--rail-w) minmax(0, 1fr) var(--right-w)',
      }}
    >
      <PageTitle />
      {mode === 'wide' ? <LeftPanel /> : <GroupRail />}
      <CanvasStage className="min-h-0" />
      {mode === 'wide' ? <RightPanel /> : <TabbedRightPanel />}
    </div>
  );
}
