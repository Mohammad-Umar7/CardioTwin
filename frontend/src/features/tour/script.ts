/**
 * The guided demo script (WORKSTATION_V2 §6.3): 5 chapters, each a few timed beats. Every beat declares
 * the *whole* app state it needs (route, selection, drawer, peel, what-if flips, reveal), so Next, Back,
 * jumping to a chapter and resuming all converge on the same picture; the runner diffs consecutive
 * states (plan.ts). Captions are templates over live values, in plain words with the clinical term, and
 * never repeat a probability that is already on screen as a numeral (V2 principle 4).
 */
import type { ExplainTab } from '@/state/uiStore';
import type { TargetId } from '@/types/contracts';

export interface Chapter {
  id: string;
  title: string;
}

export const CHAPTERS: readonly Chapter[] = [
  { id: 'answer', title: 'The answer' },
  { id: 'heart', title: 'On the heart' },
  { id: 'why', title: 'Why' },
  { id: 'lever', title: 'Pull a lever' },
  { id: 'cath', title: 'Check against the cath' },
];

/**
 * Selection a beat wants: a fixed target, the highest-risk vessel, nothing (the camera returns to where it
 * was before the selection), or 'home' (nothing selected and the camera at the home pose).
 */
export type SelectionSpec = TargetId | 'top' | 'home' | null;

export type DrawerSpec = null | { id: 'explain'; tab: ExplainTab } | { id: 'inputs'; field?: string };

export interface BeatState {
  route: 'workstation' | 'performance';
  selection: SelectionSpec;
  drawer: DrawerSpec;
  /** 'rest' = the peel rest state; 'dissect' = play the dissection and hold it open. */
  peel: 'rest' | 'dissect';
  /** Binary inputs shown flipped from their recorded value (what-if). */
  flips: readonly string[];
  revealed: boolean;
}

/** Where to spotlight: CSS selector lists (first visible match wins) or the stage's free area. */
export type SpotlightSpec = { selector: string } | { stage: true };

/** Live values captions are filled from; every field may be missing while data loads. */
export interface CaptionContext {
  patientId: string | null;
  isTest: boolean;
  /** "Very high" … (CAD band word). */
  cadBand: string | null;
  cadFlagged: boolean | null;
  nFlagged: number | null;
  nVessels: number;
  /** Selected / highest-risk vessel. */
  vessel: { id: TargetId; name: string } | null;
  /** Largest raising contribution to CAD, as a human label. */
  topDriver: string | null;
  lever: { label: string; phrase: string; from: string; to: string } | null;
  nInputs: number | null;
  nTest: number | null;
}

export interface Beat {
  id: string;
  chapter: number;
  title: string;
  caption(ctx: CaptionContext): string;
  spotlight: readonly SpotlightSpec[];
  /** Spotlight index the caption card is placed beside (default: the union of all). */
  anchor?: number;
  durationMs: number;
  state: BeatState;
}

/** The what-if lever of chapter 4 (raw dataset key; the label comes from the schema). */
export const LEVER_KEY = 'Typical Chest Pain';

export const SEL = {
  patientChip:
    '[data-region="patient-chip"], [data-tour="patient-chip"], header button[aria-label^="Patient "], [data-tour="patient-picker"], [data-region="patient-card"]',
  riskCard: '[data-region="risk-card"], [data-tour="cad-card"]',
  vesselRows: '[data-region="vessel-rows"], [data-region="vessels"], [data-tour="vessels"], [data-region="risk-card"]',
  inspector: '[data-region="inspector"]',
  explainDrawer: '[data-region="explain-drawer"], [data-tour="why"]',
  inputsDrawer: '[data-region="inputs-drawer"], [data-tour="inputs"]',
  performance: '[data-region="performance-summary"], [data-tour="performance-summary"], #summary, main h1',
} as const;

const REST: BeatState = { route: 'workstation', selection: null, drawer: null, peel: 'rest', flips: [], revealed: false };

const s = (patch: Partial<BeatState>): BeatState => ({ ...REST, ...patch });

const withName = (v: CaptionContext['vessel']) => (v ? `${v.name.charAt(0).toLowerCase()}${v.name.slice(1)} (${v.id})` : 'the highest-risk artery');

export const BEATS: readonly Beat[] = [
  // 1 · The answer ----------------------------------------------------------------------------------
  {
    id: 'patient',
    chapter: 0,
    title: 'A patient the model never saw',
    caption: (c) =>
      `${c.patientId ?? 'This'} is a real patient from the held-out test set: the model never saw them in training. ` +
      'Pick another patient from here, or start a blank one and type in your own values.',
    spotlight: [{ selector: SEL.patientChip }],
    durationMs: 7000,
    state: s({}),
  },
  {
    id: 'answer',
    chapter: 0,
    title: 'The answer',
    caption: (c) =>
      `Coronary artery disease (CAD): at least one major heart artery narrowed by half or more. The model rates it ` +
      `${c.cadBand ? `${c.cadBand.toLowerCase()} probability` : 'on a calibrated scale'}${
        c.cadFlagged === null ? '' : c.cadFlagged ? ', flagged against its decision threshold' : ', below its decision threshold'
      }, and gives each artery its own verdict${c.nFlagged === null ? '' : `: ${c.nFlagged} of ${c.nVessels} flagged`}. ` +
      'Decision support, not a diagnosis, as the bottom line says on every screen.',
    spotlight: [{ selector: SEL.riskCard }],
    durationMs: 10000,
    state: s({}),
  },
  // 2 · On the heart --------------------------------------------------------------------------------
  {
    id: 'select',
    chapter: 1,
    title: 'Select an artery',
    caption: (c) =>
      `Selecting the ${withName(c.vessel)} flies the camera to the angiographic view cardiologists read it in, and opens ` +
      "the inspector. Colour is the probability; the flag uses that artery's own threshold.",
    spotlight: [{ stage: true }, { selector: SEL.inspector }],
    anchor: 0,
    durationMs: 10000,
    state: s({ selection: 'top' }),
  },
  {
    id: 'dissect',
    chapter: 1,
    title: 'Open up the anatomy',
    caption: () =>
      'Dissection (exploded view): skin, ribs and lungs lift away layer by layer and the front wall of the heart hinges ' +
      'open, so the coronary tree stands on its own. It all comes back together when you move on.',
    spotlight: [{ stage: true }],
    durationMs: 12000,
    state: s({ selection: 'home', peel: 'dissect' }),
  },
  // 3 · Why -----------------------------------------------------------------------------------------
  {
    id: 'why',
    chapter: 2,
    title: 'What drives the estimate',
    caption: (c) =>
      'Exact SHAP values (Shapley additive explanations) show what pushes this estimate up and what pulls it down; ' +
      `they add up exactly to the result.${c.topDriver ? ` Here, ${c.topDriver.toLowerCase()} pushes hardest.` : ''}`,
    spotlight: [{ selector: SEL.explainDrawer }],
    durationMs: 8000,
    state: s({ drawer: { id: 'explain', tab: 'why' } }),
  },
  {
    id: 'physiology',
    chapter: 2,
    title: 'Physiology',
    caption: () =>
      'Physiology lists the measurements outside their normal range, such as blood pressure, lab values and ' +
      'ejection fraction: the same values the model was given.',
    spotlight: [{ selector: SEL.explainDrawer }],
    durationMs: 6000,
    state: s({ drawer: { id: 'explain', tab: 'physiology' } }),
  },
  {
    id: 'model',
    chapter: 2,
    title: 'How the estimate is made',
    caption: () =>
      'Model shows the decision threshold, how well the model does on unseen patients, and how much each kind of ' +
      'data adds: bedside history, ECG, laboratory and echocardiography.',
    spotlight: [{ selector: SEL.explainDrawer }],
    durationMs: 6000,
    state: s({ drawer: { id: 'explain', tab: 'model' } }),
  },
  // 4 · Pull a lever --------------------------------------------------------------------------------
  {
    id: 'inputs',
    chapter: 3,
    title: 'Edit inputs',
    caption: (c) =>
      `What-if analysis: any of the ${c.nInputs ? `${c.nInputs} ` : ''}clinical inputs can be changed here, and every ` +
      'number, colour and explanation follows at once.',
    spotlight: [{ selector: SEL.inputsDrawer }],
    durationMs: 7000,
    state: s({ drawer: { id: 'inputs', field: LEVER_KEY } }),
  },
  {
    id: 'lever',
    chapter: 3,
    title: 'Pull a lever',
    caption: (c) =>
      `We switched ${c.lever ? `${c.lever.label.toLowerCase()} (${c.lever.phrase})` : 'one input'} from ` +
      `${c.lever?.from ?? 'its recorded value'} to ${c.lever?.to ?? 'the opposite'}. Probabilities, colours and reasons ` +
      'update within a frame, and the recorded value stays in view as "was". It switches back when you move on.',
    spotlight: [{ selector: SEL.inputsDrawer }, { selector: SEL.riskCard }],
    anchor: 1,
    durationMs: 9000,
    state: s({ drawer: { id: 'inputs', field: LEVER_KEY }, flips: [LEVER_KEY] }),
  },
  // 5 · Check against the cath ----------------------------------------------------------------------
  {
    id: 'reveal',
    chapter: 4,
    title: 'Check against the cath',
    caption: (c) =>
      c.isTest
        ? 'Reveal cath result: the truth from coronary angiography (cardiac catheterisation) appears beside each ' +
          'estimate, including where the model is wrong.'
        : 'For held-out test patients, Reveal cath result shows the truth from coronary angiography (cardiac ' +
          'catheterisation) beside each estimate, including where the model is wrong.',
    spotlight: [{ selector: SEL.vesselRows }],
    durationMs: 7000,
    state: s({ revealed: true }),
  },
  {
    id: 'performance',
    chapter: 4,
    title: 'How well it performs',
    caption: (c) =>
      `Model performance: every figure was scored once on ${c.nTest ?? 'the'} held-out patients, with confidence ` +
      'intervals. CardioTwin is decision support for education and research, not a diagnosis.',
    spotlight: [{ selector: SEL.performance }],
    durationMs: 7000,
    state: s({ route: 'performance' }),
  },
];

export const TOTAL_MS = BEATS.reduce((t, b) => t + b.durationMs, 0);

/** First beat index of each chapter. */
export const CHAPTER_START: readonly number[] = CHAPTERS.map((_, i) => BEATS.findIndex((b) => b.chapter === i));

export const clampBeat = (i: number): number => Math.min(Math.max(0, Math.trunc(i) || 0), BEATS.length - 1);
