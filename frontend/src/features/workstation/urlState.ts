/**
 * Shareable workstation state (WORKSTATION_V2 §7, §9.3 A P2):
 *
 *   #/workstation/P-011?t=LAD&view=RAO30&panel=explain&tab=why&focus=1
 *
 * restores the exact view: the patient (path), the selected vessel `t`, the C-arm projection `view`, the
 * open drawer `panel` and its `tab`, and focus mode `focus`. Unknown parameters are kept untouched, e.g.
 * the patient owner's what-if payload `w`. Pure functions; `useWorkstationUrlState`
 * wires them to the stores and the router.
 */
import type { Chrome, DrawerId, ExplainTab } from '@/state/uiStore';

export const URL_KEYS = { target: 't', view: 'view', panel: 'panel', tab: 'tab', focus: 'focus' } as const;

const DRAWERS: readonly DrawerId[] = ['inputs', 'explain'];
const TABS: readonly ExplainTab[] = ['why', 'whatif', 'physiology', 'model'];

export interface ViewState {
  /** Selected vessel, or null for the whole heart / CAD. */
  target: string | null;
  /** Projection preset id (AP, LAO45, RAO30 …) when the camera sits on one, else null ("Custom"). */
  view: string | null;
  panel: DrawerId | null;
  /** Explain tab; written only while the Explain drawer is open. */
  tab: ExplainTab | null;
  focus: boolean;
}

export interface Vocabulary {
  /** Valid `t` values (the schema's vessel targets). */
  targets: readonly string[];
  /** Valid `view` values (projection preset ids). */
  views: readonly string[];
}

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => {
  if (!value) return null;
  return allowed.find((a) => a.toLowerCase() === value.toLowerCase()) ?? null;
};

/**
 * The view state a URL asks for. Values are matched case-insensitively against the vocabulary; anything
 * unknown is dropped (a stale or hand-edited link never selects a vessel that does not exist).
 */
export function parseViewState(search: string, vocab: Vocabulary): Partial<ViewState> {
  const params = new URLSearchParams(search);
  const out: Partial<ViewState> = {};
  const target = pick(params.get(URL_KEYS.target), vocab.targets);
  if (target) out.target = target;
  const view = pick(params.get(URL_KEYS.view), vocab.views);
  if (view) out.view = view;
  const panel = pick(params.get(URL_KEYS.panel), DRAWERS);
  if (panel) out.panel = panel;
  const tab = pick(params.get(URL_KEYS.tab), TABS);
  if (tab) out.tab = tab;
  const focus = params.get(URL_KEYS.focus);
  if (focus === '1' || focus === 'true') out.focus = true;
  return out;
}

/**
 * `current` search string with the view keys rewritten from `state` (absent values removed) and every
 * other parameter kept in place. Returns "" or "?…". Key order is stable: t, view, panel, tab, focus.
 */
export function serializeViewState(state: ViewState, current: string): string {
  const params = new URLSearchParams(current);
  for (const key of Object.values(URL_KEYS)) params.delete(key);
  const next = new URLSearchParams();
  if (state.target) next.set(URL_KEYS.target, state.target);
  if (state.view) next.set(URL_KEYS.view, state.view);
  if (state.panel) next.set(URL_KEYS.panel, state.panel);
  if (state.panel === 'explain' && state.tab) next.set(URL_KEYS.tab, state.tab);
  if (state.focus) next.set(URL_KEYS.focus, '1');
  for (const [k, v] of params) next.append(k, v);
  const text = next.toString();
  return text ? `?${text}` : '';
}

/** Workstation path for a patient: `/workstation/P-011`, or `/workstation` for a blank patient. */
export function workstationPath(base: string, patientId: string | null): string {
  return patientId ? `${base}/${encodeURIComponent(patientId)}` : base;
}

export interface StoreSnapshot {
  selectedStructure: string | null;
  /** Last camera command, when it was a projection preset. */
  preset: string | null;
  drawer: DrawerId | null;
  explainTab: ExplainTab;
  chrome: Chrome;
}

/** The URL-worthy part of the stores. The tour and landing presets never write `focus`. */
export function viewStateFromStores(s: StoreSnapshot): ViewState {
  return {
    target: s.selectedStructure,
    view: s.preset,
    panel: s.drawer,
    tab: s.drawer === 'explain' ? s.explainTab : null,
    focus: s.chrome === 'focus',
  };
}
