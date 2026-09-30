/**
 * Guided tour steps (DESIGN_SYSTEM §5 TourCoachmark). Each step spotlights the first element matching
 * `target` (a `data-tour` attribute) on the workstation. Phase 2 can add actions (auto-select LAD, flip a
 * toggle, run the peel) through `onEnter`.
 */
export interface TourStep {
  id: string;
  /** CSS selector of the spotlit element. */
  target: string;
  title: string;
  body: string;
  onEnter?: () => void;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'status',
    target: '[data-tour="status-line"]',
    title: 'Decision support, not a diagnosis',
    body: 'This line is always visible. Every estimate is a model output for education and research, never a substitute for angiography or CTCA.',
  },
  {
    id: 'patient',
    target: '[data-tour="patient-picker"], [data-tour="inputs"]',
    title: 'A patient the model never saw',
    body: 'The workstation opens on a held-out TEST patient. Pick another, or switch to Custom and enter your own values.',
  },
  {
    id: 'cad',
    target: '[data-tour="cad-card"]',
    title: 'Overall CAD estimate',
    body: 'Calibrated probability, its band and the deployed decision threshold. Colour is never the only cue: the number, band word and meter always travel together.',
  },
  {
    id: 'vessels',
    target: '[data-tour="vessels"]',
    title: 'Vessel by vessel',
    body: 'LAD, LCX and RCA each have their own model. Select a vessel here or click it in 3D: the camera flies to the C-arm view cardiologists use for that artery.',
  },
  {
    id: 'why',
    target: '[data-tour="why"]',
    title: 'Why this estimate?',
    body: 'A template-built sentence, then exact SHAP contributions in log-odds. Hover a phrase or a bar to find the matching input.',
  },
  {
    id: 'what-if',
    target: '[data-tour="what-if"], [data-tour="inputs"]',
    title: 'Pull a lever',
    body: 'Change any input and every number, colour and explanation updates within a frame or two. Pin A/B to keep the original as “was → now”.',
  },
  {
    id: 'engine',
    target: '[data-tour="engine"]',
    title: 'Provenance',
    body: 'The engine pill says which engine produced the numbers and which model version. Model performance and methodology are one click away in the top bar.',
  },
];
