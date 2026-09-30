/**
 * Side effects of the guided demo: executing planned actions against the stores, the peel tween, the
 * showcase patient and the caption context. Everything goes through public store actions; nothing here
 * owns state of its own except the running peel animation.
 */
import { highestRiskVessel, topDrivers } from '@/features/landing/heroModel';
import type { SchemaIndex } from '@/hooks/useData';
import { pickDefaultPatient } from '@/lib/patients';
import { ROUTES } from '@/routes';
import { editedKeys, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import { RISK_BAND_STYLES } from '@/theme/risk';
import type { CohortPatient, FeatureValue, PredictResponse, TargetId } from '@/types/contracts';
import type { TourAction } from './plan';
import { LEVER_KEY, type CaptionContext } from './script';

// ------------------------------------------------------------------------------------ peel tween

/** LUMEN `peel` easing, cubic-bezier(.65,0,.35,1), approximated by ease-in-out cubic. */
export const peelEase = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Peel durations (LUMEN §6): 1400 ms forward, 1100 ms assemble; closing before a dissection is quicker. */
export const PEEL_FORWARD_MS = 1400;
export const PEEL_ASSEMBLE_MS = 1100;
export const PEEL_CLOSE_MS = 500;

export interface PeelSegment {
  from: number;
  to: number;
  ms: number;
}

/**
 * Segments for a peel request. 'dissect' first closes the chest (so the whole dissection plays: skin,
 * ribs like a book, lungs aside, then the heart wall), then opens to e = 1. 'rest' assembles to 0.60.
 */
export function peelSegments(current: number, to: 'dissect' | 'rest'): PeelSegment[] {
  if (to === 'rest') return Math.abs(current - PEEL_REST) < 1e-3 ? [] : [{ from: current, to: PEEL_REST, ms: PEEL_ASSEMBLE_MS }];
  const segs: PeelSegment[] = [];
  if (current > 0.02) segs.push({ from: current, to: 0, ms: PEEL_CLOSE_MS });
  segs.push({ from: current > 0.02 ? 0 : current, to: 1, ms: PEEL_FORWARD_MS });
  return segs;
}

export class PeelAnimator {
  private raf = 0;
  private token = 0;

  cancel(): void {
    this.token += 1;
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Plays the peel toward `to`; instant under reduced motion. Resolves when done or cancelled. */
  run(to: 'dissect' | 'rest', reduced: boolean): Promise<void> {
    return this.play(peelSegments(useViewerStore.getState().explode, to), reduced);
  }

  /** Assembles (or opens) to an exact peel value, e.g. the pre-tour state on exit. */
  tweenTo(value: number, reduced: boolean): Promise<void> {
    const from = useViewerStore.getState().explode;
    if (Math.abs(from - value) < 1e-3) return Promise.resolve();
    return this.play([{ from, to: value, ms: value < from ? PEEL_ASSEMBLE_MS : PEEL_FORWARD_MS }], reduced);
  }

  private play(segs: PeelSegment[], reduced: boolean): Promise<void> {
    this.cancel();
    const viewer = useViewerStore.getState();
    if (segs.length === 0) return Promise.resolve();
    if (reduced || typeof requestAnimationFrame !== 'function') {
      viewer.setExplode(segs[segs.length - 1]!.to);
      return Promise.resolve();
    }
    const token = this.token;
    return new Promise((resolve) => {
      let i = 0;
      let start = performance.now();
      const step = (now: number) => {
        if (token !== this.token) return resolve();
        const seg = segs[i]!;
        const t = Math.min(1, (now - start) / seg.ms);
        useViewerStore.getState().setExplode(seg.from + (seg.to - seg.from) * peelEase(t));
        if (t >= 1) {
          i += 1;
          start = now;
          if (i >= segs.length) {
            this.raf = 0;
            return resolve();
          }
        }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }
}

// ------------------------------------------------------------------------------------- actions

/** Value a binary input shows while flipped: 0 ⇄ 1 (non-binary values are left alone). */
export function flippedValue(recorded: FeatureValue | undefined): FeatureValue | undefined {
  if (recorded === 0 || recorded === 1) return recorded === 1 ? 0 : 1;
  return recorded;
}

export interface ExecuteDeps {
  navigate(to: string): void;
  reduced: boolean;
  peel: PeelAnimator;
}

export function executeAction(action: TourAction, deps: ExecuteDeps): void {
  const ui = useUiStore.getState();
  const viewer = useViewerStore.getState();
  const patient = usePatientStore.getState();
  switch (action.kind) {
    case 'route':
      deps.navigate(action.to === 'performance' ? ROUTES.performance : ROUTES.workstation);
      break;
    case 'select':
      if (viewer.selectedStructure !== action.target) viewer.select(action.target);
      break;
    case 'home':
      viewer.flyHome();
      break;
    case 'drawer': {
      const d = action.drawer;
      if (d === null) {
        if (ui.drawer !== null) ui.closeDrawer();
      } else if (d.id === 'explain') {
        if (ui.drawer === 'explain') ui.setExplainTab(d.tab);
        else ui.openDrawer('explain', { tab: d.tab });
      } else {
        ui.openDrawer('inputs', d.field ? { field: d.field } : undefined);
      }
      break;
    }
    case 'peel':
      void deps.peel.run(action.to, deps.reduced);
      break;
    case 'flip': {
      const rec = patient.recorded[action.key];
      const value = action.flipped ? flippedValue(rec) : rec;
      if (value !== undefined && patient.features[action.key] !== value) patient.setFeature(action.key, value);
      break;
    }
    case 'reveal':
      // Cath truth exists for held-out TEST patients only.
      if (patient.split === 'test' && patient.revealed !== action.revealed) patient.setRevealed(action.revealed);
      break;
  }
}

// ------------------------------------------------------------------------------ showcase patient

/**
 * The demo runs on the curated high-risk TEST patient (V2 §6.3 chapter 1), untouched: loaded unless it is
 * already open with no edits and the cath result hidden. Returns true when it switched patients.
 */
export function ensureShowcasePatient(patients: readonly CohortPatient[] | null | undefined): boolean {
  const showcase = patients ? pickDefaultPatient(patients) : null;
  if (!showcase) return false;
  const s = usePatientStore.getState();
  const clean = s.selectedPatientId === showcase.id && editedKeys(s.features, s.recorded).length === 0 && !s.revealed;
  if (clean) return false;
  s.loadPatient(showcase);
  return true;
}

// ------------------------------------------------------------------------------ caption context

/** Plain-words gloss of the chapter-4 lever. */
export const LEVER_PHRASE = 'chest pressure on exertion, eased by rest';

const yesNo = (v: FeatureValue | undefined) => (v === 1 ? 'Yes' : v === 0 ? 'No' : null);

export interface CaptionInput {
  patientId: string | null;
  split: string | null;
  prediction: PredictResponse | null;
  recorded: Record<string, FeatureValue>;
  schema: SchemaIndex | null;
  vessel: TargetId | null;
  nTest: number | null;
}

export function buildCaptionContext(i: CaptionInput): CaptionContext {
  const vessels = i.schema?.vessels.map((t) => t.id) ?? ['LAD', 'LCX', 'RCA'];
  const cad = i.prediction?.predictions.CAD;
  const vesselId = i.vessel ?? highestRiskVessel(i.prediction, vessels);
  const up = topDrivers(i.prediction, i.schema?.byKey, 'CAD', 5).find((d) => d.direction === 'up');
  const leverSpec = i.schema?.byKey.get(LEVER_KEY);
  const from = yesNo(i.recorded[LEVER_KEY]);
  const to = yesNo(flippedValue(i.recorded[LEVER_KEY]));
  return {
    patientId: i.patientId,
    isTest: i.split === 'test',
    cadBand: cad ? RISK_BAND_STYLES[cad.risk_band].label : null,
    cadFlagged: cad ? cad.label === 1 : null,
    nFlagged: i.prediction ? vessels.filter((v) => i.prediction?.predictions[v]?.label === 1).length : null,
    nVessels: vessels.length,
    vessel: vesselId ? { id: vesselId, name: i.schema?.targetById.get(vesselId)?.label ?? vesselId } : null,
    topDriver: up?.label ?? null,
    lever: leverSpec && from && to ? { label: leverSpec.label, phrase: LEVER_PHRASE, from, to } : null,
    nInputs: i.schema?.features.length ?? null,
    nTest: i.nTest,
  };
}
