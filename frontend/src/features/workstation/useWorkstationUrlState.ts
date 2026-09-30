import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { ROUTES } from '@/routes';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore, type ViewerState } from '@/state/viewerStore';
import { PROJECTIONS } from '@/three/camera/presets';
import type { TargetId } from '@/types/contracts';
import {
  parseViewState,
  serializeViewState,
  viewStateFromStores,
  workstationPath,
  type ViewState,
  type Vocabulary,
} from './urlState';

/** Store changes are coalesced into one URL write per this window (a selection moves 3 stores). */
const WRITE_DEBOUNCE_MS = 120;
/** The camera still "sits on" a projection when the live C-arm angles are within this many degrees. */
const PRESET_TOLERANCE_DEG = 4;

const FALLBACK_TARGETS = ['LAD', 'LCX', 'RCA'];
const VIEWS = PROJECTIONS.map((p) => p.id);

/** The projection the camera sits on, or null after a free orbit ("Custom"). */
export function currentPreset(v: Pick<ViewerState, 'cameraCommand' | 'carm' | 'selectedStructure'>): string | null {
  const cmd = v.cameraCommand;
  if (cmd?.kind !== 'preset' || !cmd.preset) return null;
  const preset = PROJECTIONS.find((p) => p.id === cmd.preset);
  if (!preset) return null;
  if (!v.carm) return preset.id;
  const off =
    Math.abs(v.carm.azimuth - preset.azimuth) > PRESET_TOLERANCE_DEG ||
    Math.abs(v.carm.elevation - preset.elevation) > PRESET_TOLERANCE_DEG;
  return off ? null : preset.id;
}

/** Applies a parsed URL to the stores. Absent keys leave the current state alone. */
export function applyViewState(s: Partial<ViewState>): void {
  const ui = useUiStore.getState();
  const viewer = useViewerStore.getState();
  if (s.focus && ui.chrome === 'workstation') ui.setChrome('focus');
  if (s.target && viewer.selectedStructure !== s.target) viewer.select(s.target as TargetId);
  if (s.view) viewer.flyToPreset(s.view);
  if (s.panel) {
    if (ui.drawer !== s.panel || (s.tab && ui.explainTab !== s.tab)) ui.openDrawer(s.panel, s.tab ? { tab: s.tab } : undefined);
  } else if (s.tab) {
    ui.setExplainTab(s.tab);
  }
}

/**
 * Keeps `#/workstation/<patient>?t=&view=&panel=&tab=&focus=` in sync with the stores (WORKSTATION_V2 §7):
 *   - URL → stores on mount and on any navigation this hook did not make itself (deep links from the
 *     landing pillars, the tour, the report), so a pasted link restores the exact view;
 *   - stores → URL with `replace` (the view never floods the history), debounced 120 ms, keeping every
 *     parameter it does not own (`w`, `layout`).
 * The patient path is only rewritten once the cohort is loaded, so a deep link to /workstation/P-017 is
 * never overwritten by the default patient before the route patient loads.
 */
export function useWorkstationUrlState(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientId } = useParams();
  const index = useSchemaIndex();
  const cohortReady = useCohort().status === 'ready';

  const loc = useRef(location);
  loc.current = location;
  const routePatient = useRef(patientId);
  routePatient.current = patientId;
  const ready = useRef(cohortReady);
  ready.current = cohortReady;
  const vocab = useRef<Vocabulary>({ targets: FALLBACK_TARGETS, views: VIEWS });
  vocab.current = { targets: index?.vessels.map((v) => v.id) ?? FALLBACK_TARGETS, views: VIEWS };
  const lastWritten = useRef<string | null>(null);

  // URL → stores (mount + external navigations).
  useEffect(() => {
    if (`${location.pathname}${location.search}` === lastWritten.current) return;
    applyViewState(parseViewState(location.search, vocab.current));
  }, [location.pathname, location.search]);

  // Stores → URL.
  useEffect(() => {
    let timer: number | undefined;
    const write = () => {
      timer = undefined;
      const ui = useUiStore.getState();
      const viewer = useViewerStore.getState();
      const patient = usePatientStore.getState();
      const state = viewStateFromStores({
        selectedStructure: viewer.selectedStructure,
        preset: currentPreset(viewer),
        drawer: ui.drawer,
        explainTab: ui.explainTab,
        chrome: ui.chrome,
      });
      const here = loc.current;
      const storeId = patient.mode === 'cohort' ? patient.selectedPatientId : null;
      const waiting = routePatient.current && routePatient.current !== storeId && !ready.current;
      const pathname = waiting ? here.pathname : workstationPath(ROUTES.workstation, storeId);
      const search = serializeViewState(state, here.search);
      const target = `${pathname}${search}`;
      if (target === `${here.pathname}${here.search}`) return;
      lastWritten.current = target;
      navigate(target, { replace: true });
    };
    const schedule = () => {
      if (timer === undefined) timer = window.setTimeout(write, WRITE_DEBOUNCE_MS);
    };
    const unsubscribe = [useUiStore.subscribe(schedule), useViewerStore.subscribe(schedule), usePatientStore.subscribe(schedule)];
    schedule();
    return () => {
      unsubscribe.forEach((u) => u());
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [navigate]);
}
