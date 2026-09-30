/**
 * Canonical command ids and shortcuts (WORKSTATION_V2 §4.10). Owners register these ids so the palette,
 * the shortcut sheet and tooltips agree. Ids marked "interim" are registered by the shell/workstation at
 * priority −1 until their owner registers the same id at priority 0, which replaces them.
 */
export const CMD = {
  // Shell (agent A)
  paletteOpen: 'palette.open', // Mod+K, /
  shortcuts: 'help.shortcuts', // ?
  focusMode: 'chrome.focus', // \
  inputsDrawer: 'drawer.inputs', // I
  explainDrawer: 'drawer.explain', // E
  calm: 'view.calm', // C
  pageHome: 'page.home',
  pageWorkstation: 'page.workstation',
  pagePerformance: 'page.performance',
  pageMethodology: 'page.methodology',
  patientCard: 'chrome.patient-card', // collapse / expand the patient card
  details: 'help.details', // intended use, dataset, licences
  copyLink: 'app.copy-link', // shareable URL state (V2 §7)
  fullscreen: 'view.fullscreen', // interim until D's ⋯ menu registers it
  // Tour (agent E) — interim
  tourStart: 'tour.start',
  // Vessels (agent C) — interim: select (1 2 3)
  selectVessel: (target: string) => `vessel.select.${target}`,
  explainVessel: (target: string) => `vessel.explain.${target}`,
  // Explain drawer tabs (agent C) — interim
  explainTab: (tab: string) => `explain.tab.${tab}`,
  reveal: 'risk.reveal', // Reveal cath result (agent C; TEST patients only)
  // Views and layers (agent D) — interim
  home: 'view.home', // 0, H
  projectionPrev: 'view.projection.prev', // [
  projectionNext: 'view.projection.next', // ]
  beat: 'view.beat', // B
  flow: 'view.flow', // F
  territories: 'view.territories', // T
  labels: 'view.labels', // L
  isolate: 'view.isolate', // O
  ghost: 'view.ghost', // G
  peel: 'view.peel', // P
  projection: (preset: string) => `view.projection.${preset}`, // AP, LAO45, RAO30, … — interim
  look: (look: string) => `view.look.${look}`, // clay | anat — interim
  // Patients and inputs (agent B)
  resetEdits: 'inputs.reset',
  blankPatient: 'patient.blank',
  randomTestPatient: 'patient.random-test',
  lowRiskPatient: 'patient.low-risk', // palette suggestion "Open a low-risk patient"
  // Group-level interim lists (registered with `yieldToGroup`, so B's own ids replace them wholesale)
  openPatient: (id: string) => `patient.open.${id}`,
  editInput: (key: string) => `input.edit.${key}`,
  inputsSearch: 'inputs.search', // / while the Inputs drawer is open (register at priority ≥ 1)
} as const;

export const SHORTCUT = {
  palette: 'Mod+K,/',
  shortcuts: '?',
  focusMode: '\\',
  inputs: 'I',
  explain: 'E',
  calm: 'C',
  vessels: ['1', '2', '3'],
  home: '0,H',
  projectionPrev: '[',
  projectionNext: ']',
  beat: 'B',
  flow: 'F',
  territories: 'T',
  labels: 'L',
  isolate: 'O',
  ghost: 'G',
  peel: 'P',
} as const;
