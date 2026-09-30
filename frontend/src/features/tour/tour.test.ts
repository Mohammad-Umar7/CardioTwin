import { beforeEach, describe, expect, it } from 'vitest';
import { indexSchema } from '@/hooks/useData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import { sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import { overallProgress, tick, type ClockState } from './clock';
import { inflate, mergeOverlapping, placeCard, scrimPath, union, type Bounds } from './geometry';
import { planTransition } from './plan';
import {
  PeelAnimator,
  buildCaptionContext,
  ensureShowcasePatient,
  executeAction,
  flippedValue,
  peelSegments,
} from './runtime';
import { BEATS, CHAPTERS, CHAPTER_START, LEVER_KEY, TOTAL_MS, type BeatState, type CaptionContext } from './script';
import { captureSnapshot, restoreStores } from './snapshot';

const schema = indexSchema(sampleSchema);

const fullContext: CaptionContext = {
  patientId: 'P-011',
  isTest: true,
  cadBand: 'Very high',
  cadFlagged: true,
  nFlagged: 2,
  nVessels: 3,
  vessel: { id: 'LAD', name: 'Left anterior descending artery' },
  topDriver: 'Typical angina',
  lever: { label: 'Typical angina', phrase: 'chest pressure on exertion', from: 'Yes', to: 'No' },
  nInputs: 53,
  nTest: 61,
};
const emptyContext: CaptionContext = {
  patientId: null,
  isTest: false,
  cadBand: null,
  cadFlagged: null,
  nFlagged: null,
  nVessels: 3,
  vessel: null,
  topDriver: null,
  lever: null,
  nInputs: null,
  nTest: null,
};

describe('script', () => {
  it('has 5 chapters in order and fits the 100 s budget (≈ 90 s)', () => {
    expect(CHAPTERS.map((c) => c.title)).toEqual(['The answer', 'On the heart', 'Why', 'Pull a lever', 'Check against the cath']);
    expect(TOTAL_MS).toBeLessThanOrEqual(90_000);
    expect(CHAPTER_START).toEqual([0, 2, 4, 7, 9]);
    const chapters = BEATS.map((b) => b.chapter);
    expect([...chapters].sort((a, b) => a - b)).toEqual(chapters);
  });

  it('covers patient, verdicts, 3D selection, dissection, SHAP, physiology, modalities, what-if, cath and performance', () => {
    const text = BEATS.map((b) => b.caption(fullContext)).join(' ');
    for (const term of [
      'held-out test set',
      'Coronary artery disease (CAD)',
      '2 of 3 flagged',
      'angiographic view',
      'inspector',
      'Dissection (exploded view)',
      'SHAP',
      'Physiology',
      'ECG, laboratory and echocardiography',
      'What-if',
      'typical angina',
      'catheterisation',
      'Model performance',
      'not a diagnosis',
    ]) {
      expect(text).toContain(term);
    }
  });

  it('never prints a probability numeral (one home per number) and never calls an estimate a diagnosis', () => {
    for (const b of BEATS) {
      for (const ctx of [fullContext, emptyContext]) {
        const caption = b.caption(ctx);
        expect(caption).not.toMatch(/\d\s?%/);
        expect(caption.replace(/not a diagnosis/gi, '')).not.toMatch(/\bdiagnos/i);
        expect(caption).not.toMatch(/undefined|null|NaN/);
        expect(caption.split(/\s+/).length).toBeLessThanOrEqual(60);
      }
    }
  });

  it('gives every beat a complete state: only chapter 5 reveals, only chapter 4 flips', () => {
    for (const b of BEATS) {
      expect(b.state.revealed).toBe(b.chapter === 4 && b.id === 'reveal');
      expect(b.state.flips.length > 0).toBe(b.id === 'lever');
    }
  });
});

describe('planTransition', () => {
  const byId = (id: string) => BEATS.find((b) => b.id === id)!.state;

  it('applies everything at the start', () => {
    const kinds = planTransition(null, byId('patient'), 'LAD').map((a) => a.kind);
    expect(kinds).toEqual(['route', 'reveal', 'select', 'drawer', 'peel']);
  });

  it('only diffs between neighbours, and undoes a flip when moving on', () => {
    expect(planTransition(byId('patient'), byId('answer'), 'LAD')).toEqual([]);
    expect(planTransition(byId('answer'), byId('select'), 'LAD')).toEqual([{ kind: 'select', target: 'LAD' }]);
    expect(planTransition(byId('inputs'), byId('lever'), 'LAD')).toEqual([{ kind: 'flip', key: LEVER_KEY, flipped: true }]);
    expect(planTransition(byId('lever'), byId('reveal'), 'LAD')).toEqual([
      { kind: 'flip', key: LEVER_KEY, flipped: false },
      { kind: 'reveal', revealed: true },
      { kind: 'drawer', drawer: null },
    ]);
  });

  it('flies home before the dissection and simply clears afterwards', () => {
    expect(planTransition(byId('select'), byId('dissect'), 'LAD')).toEqual([{ kind: 'home' }, { kind: 'peel', to: 'dissect' }]);
    expect(planTransition(byId('dissect'), byId('why'), 'LAD')).toEqual([
      { kind: 'select', target: null },
      { kind: 'drawer', drawer: { id: 'explain', tab: 'why' } },
      { kind: 'peel', to: 'rest' },
    ]);
  });

  it('changes route last when leaving the workstation and first when coming back', () => {
    const out = planTransition(byId('reveal'), byId('performance'), 'LAD');
    expect(out[out.length - 1]).toEqual({ kind: 'route', to: 'performance' });
    const back = planTransition(byId('performance'), byId('reveal'), 'LAD');
    expect(back[0]).toEqual({ kind: 'route', to: 'workstation' });
  });

  it('converges from any beat to any other', () => {
    const apply = (s: BeatState, actions: ReturnType<typeof planTransition>): BeatState => {
      let out = { ...s, flips: [...s.flips] };
      for (const a of actions) {
        if (a.kind === 'route') out = { ...out, route: a.to };
        if (a.kind === 'select') out = { ...out, selection: a.target };
        if (a.kind === 'home') out = { ...out, selection: 'home' };
        if (a.kind === 'drawer') out = { ...out, drawer: a.drawer };
        if (a.kind === 'peel') out = { ...out, peel: a.to };
        if (a.kind === 'reveal') out = { ...out, revealed: a.revealed };
        if (a.kind === 'flip') out = { ...out, flips: a.flipped ? [...out.flips, a.key] : out.flips.filter((k) => k !== a.key) };
      }
      return out;
    };
    const norm = (s: BeatState) => ({ ...s, selection: s.selection === 'top' ? 'LAD' : s.selection, flips: [...s.flips].sort() });
    for (const a of BEATS) {
      for (const b of BEATS) {
        const start = norm(a.state);
        expect(norm(apply(start, planTransition(a.state, b.state, 'LAD')))).toEqual(norm(b.state));
      }
    }
  });
});

describe('geometry', () => {
  const bounds: Bounds = { left: 0, top: 48, right: 1440, bottom: 820 };

  it('merges overlapping holes and builds an even-odd scrim path', () => {
    const merged = mergeOverlapping([
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 50, top: 50, width: 100, height: 100 },
      { left: 400, top: 0, width: 10, height: 10 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ left: 0, top: 0, width: 150, height: 150 });
    expect(scrimPath(200, 100, merged)).toMatch(/^M0 0H200V100H0Z M/);
    expect(inflate({ left: 10, top: 10, width: 10, height: 10 }, 6)).toEqual({ left: 4, top: 4, width: 22, height: 22 });
    expect(union([])).toBeNull();
  });

  it('places the card beside a card-sized target, inside a stage-sized one, and within bounds', () => {
    const card = { width: 360, height: 200 };
    const risk = { left: 1076, top: 60, width: 352, height: 452 };
    const p = placeCard(risk, card, bounds);
    expect(p.side).toBe('left');
    expect(p.left + card.width).toBeLessThanOrEqual(risk.left);
    const stage = placeCard({ left: 0, top: 48, width: 1440, height: 772 }, card, bounds);
    expect(stage.side).toBe('inside');
    expect(stage.top + card.height).toBeLessThanOrEqual(bounds.bottom);
    expect(placeCard(null, card, bounds).side).toBe('inside');
  });

  it('keeps the card off the stage cards and numerals it is told to avoid (patient chip beat at 1280)', () => {
    const b = { left: 0, top: 84, right: 1280, bottom: 592 };
    const card = { width: 360, height: 196 };
    const chip = { left: 560, top: 8, width: 120, height: 32 };
    const riskCard = { left: 940, top: 44, width: 336, height: 540 };
    const patientCard = { left: 4, top: 44, width: 272, height: 320 };
    const overlapsRect = (a: { left: number; top: number; width: number; height: number }) =>
      a.left < riskCard.left + riskCard.width && riskCard.left < a.left + card.width && a.top < riskCard.top + riskCard.height && riskCard.top < a.top + card.height;
    // Without keep-outs the card goes right of the chip, over the CAD numeral.
    expect(overlapsRect(placeCard(chip, card, b))).toBe(true);
    const p = placeCard(chip, card, b, 16, [riskCard, patientCard]);
    expect(overlapsRect(p)).toBe(false);
    expect(p.left).toBeGreaterThanOrEqual(patientCard.left + patientCard.width);
    expect(p.left + card.width).toBeLessThanOrEqual(riskCard.left);
    expect(p.top).toBeGreaterThanOrEqual(b.top);
    // The live chip sits at the right of the top bar, above the risk card: the card slides left of it.
    const rightChip = { left: 987, top: 8, width: 141, height: 32 };
    const q = placeCard(rightChip, card, b, 16, [riskCard, patientCard]);
    expect(overlapsRect(q)).toBe(false);
    expect(q.left).toBeGreaterThanOrEqual(patientCard.left + patientCard.width);
  });
});

describe('clock', () => {
  const durations = [1000, 2000];
  const s0: ClockState = { beat: 0, elapsed: 0, playing: true, ended: false };

  it('advances beats, holds at the end and caps long frames', () => {
    let s = tick(s0, 5000, durations);
    expect(s).toMatchObject({ beat: 0, elapsed: 100 });
    for (let i = 0; i < 10; i += 1) s = tick(s, 100, durations);
    expect(s.beat).toBe(1);
    for (let i = 0; i < 30; i += 1) s = tick(s, 100, durations);
    expect(s).toMatchObject({ beat: 1, ended: true, playing: false, elapsed: 2000 });
    expect(overallProgress(s, durations)).toBe(1);
  });

  it('does not move while paused', () => {
    expect(tick({ ...s0, playing: false }, 50, durations)).toEqual({ ...s0, playing: false });
    expect(overallProgress({ beat: 1, elapsed: 500 }, durations)).toBeCloseTo(0.5);
  });
});

describe('runtime', () => {
  beforeEach(() => {
    usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
    useViewerStore.setState({ selectedStructure: null, explode: PEEL_REST });
    useUiStore.setState({ drawer: null, explainTab: 'why', chrome: 'workstation' });
  });

  it('plans the dissection from closed to open, and assembles back to rest', () => {
    expect(peelSegments(PEEL_REST, 'dissect')).toEqual([
      { from: PEEL_REST, to: 0, ms: 500 },
      { from: 0, to: 1, ms: 1400 },
    ]);
    expect(peelSegments(1, 'rest')).toEqual([{ from: 1, to: PEEL_REST, ms: 1100 }]);
    expect(peelSegments(PEEL_REST, 'rest')).toEqual([]);
  });

  it('jumps the peel under reduced motion', async () => {
    await new PeelAnimator().run('dissect', true);
    expect(useViewerStore.getState().explode).toBe(1);
  });

  it('flips a binary input and puts it back', () => {
    expect(flippedValue(1)).toBe(0);
    expect(flippedValue(0)).toBe(1);
    expect(flippedValue('N')).toBe('N');
    const deps = { navigate: () => {}, reduced: true, peel: new PeelAnimator() };
    const rec = usePatientStore.getState().recorded[LEVER_KEY];
    executeAction({ kind: 'flip', key: LEVER_KEY, flipped: true }, deps);
    expect(usePatientStore.getState().features[LEVER_KEY]).toBe(flippedValue(rec));
    executeAction({ kind: 'flip', key: LEVER_KEY, flipped: false }, deps);
    expect(usePatientStore.getState().features[LEVER_KEY]).toBe(rec);
  });

  it('opens drawers on the right tab and reveals only for test patients', () => {
    const deps = { navigate: () => {}, reduced: true, peel: new PeelAnimator() };
    executeAction({ kind: 'drawer', drawer: { id: 'explain', tab: 'physiology' } }, deps);
    expect(useUiStore.getState()).toMatchObject({ drawer: 'explain', explainTab: 'physiology' });
    executeAction({ kind: 'drawer', drawer: { id: 'explain', tab: 'model' } }, deps);
    expect(useUiStore.getState().explainTab).toBe('model');
    executeAction({ kind: 'drawer', drawer: null }, deps);
    expect(useUiStore.getState().drawer).toBeNull();
    executeAction({ kind: 'reveal', revealed: true }, deps);
    expect(usePatientStore.getState().revealed).toBe(sampleCohort.patients[0]!.split === 'test');
  });

  it('loads the showcase test patient unless it is already open and untouched', () => {
    const s = usePatientStore.getState();
    ensureShowcasePatient(sampleCohort.patients);
    const id = usePatientStore.getState().selectedPatientId;
    expect(sampleCohort.patients.find((p) => p.id === id)?.split).toBe('test');
    expect(ensureShowcasePatient(sampleCohort.patients)).toBe(false);
    usePatientStore.getState().setFeature('BP', 190);
    expect(ensureShowcasePatient(sampleCohort.patients)).toBe(true);
    expect(s).toBeDefined();
  });

  it('fills the caption context from live values', () => {
    const ctx = buildCaptionContext({
      patientId: 'P-001',
      split: 'test',
      prediction: samplePrediction,
      recorded: { [LEVER_KEY]: 1 },
      schema,
      vessel: null,
      nTest: 61,
    });
    expect(ctx).toMatchObject({
      cadBand: 'Very high',
      cadFlagged: true,
      nFlagged: 2,
      vessel: { id: 'LAD', name: 'Left anterior descending artery' },
      topDriver: 'Typical chest pain',
      lever: { from: 'Yes', to: 'No' },
    });
  });
});

describe('snapshot', () => {
  it('restores patient, edits, reveal, selection, peel, drawers and chrome exactly', () => {
    const patient = sampleCohort.patients[1] ?? sampleCohort.patients[0]!;
    usePatientStore.getState().loadPatient(patient);
    usePatientStore.getState().setFeature('BP', 150);
    useViewerStore.setState({ selectedStructure: 'RCA', explode: 0.3, isolate: true, territoryMode: 'all' });
    useUiStore.setState({ chrome: 'focus', drawer: 'inputs', patientCardOpen: false, explainTab: 'model' });
    const snap = captureSnapshot('/workstation?t=RCA');

    usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
    usePatientStore.getState().setRevealed(true);
    useViewerStore.setState({ selectedStructure: 'LAD', explode: 1, isolate: false, territoryMode: 'selected' });
    useUiStore.setState({ chrome: 'tour', drawer: 'explain', patientCardOpen: true, explainTab: 'why' });

    restoreStores(snap);
    expect(snap.route).toBe('/workstation?t=RCA');
    expect(usePatientStore.getState()).toMatchObject({ selectedPatientId: patient.id, revealed: false });
    expect(usePatientStore.getState().features.BP).toBe(150);
    expect(useViewerStore.getState()).toMatchObject({ selectedStructure: 'RCA', explode: 0.3, isolate: true, territoryMode: 'all' });
    expect(useUiStore.getState()).toMatchObject({ chrome: 'focus', drawer: 'inputs', patientCardOpen: false, explainTab: 'model' });
  });
});
