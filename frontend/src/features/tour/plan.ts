/**
 * Turns "the state this beat needs" into an ordered list of store actions (pure; unit-tested). Moving
 * between any two beats — forward, back, or a jump — diffs their declared states, so the app always ends
 * in exactly the beat's picture. `prev = null` (tour start or resume) applies everything, because the
 * app's current state is unknown.
 */
import type { TargetId } from '@/types/contracts';
import type { BeatState, DrawerSpec, SelectionSpec } from './script';

export type TourAction =
  | { kind: 'route'; to: BeatState['route'] }
  | { kind: 'select'; target: TargetId | null }
  | { kind: 'home' }
  | { kind: 'drawer'; drawer: DrawerSpec }
  | { kind: 'peel'; to: BeatState['peel'] }
  | { kind: 'flip'; key: string; flipped: boolean }
  | { kind: 'reveal'; revealed: boolean };

const sameDrawer = (a: DrawerSpec, b: DrawerSpec): boolean => {
  if (a === null || b === null) return a === b;
  if (a.id !== b.id) return false;
  if (a.id === 'explain' && b.id === 'explain') return a.tab === b.tab;
  if (a.id === 'inputs' && b.id === 'inputs') return a.field === b.field;
  return false;
};

export function resolveSelection(spec: SelectionSpec, top: TargetId | null): TargetId | null {
  return spec === 'top' ? top : spec === 'home' ? null : spec;
}

export function planTransition(prev: BeatState | null, next: BeatState, top: TargetId | null): TourAction[] {
  const all = prev === null;
  const actions: TourAction[] = [];
  const toWorkstation = next.route === 'workstation' && (all || prev.route !== 'workstation');

  // Coming back to the workstation: change route first so the stage exists for what follows.
  if (toWorkstation) actions.push({ kind: 'route', to: 'workstation' });

  // Patient data first (flips, reveal), so predictions start while the camera and drawers move.
  const before = new Set(all ? [] : prev.flips);
  const after = new Set(next.flips);
  for (const key of after) if (!before.has(key)) actions.push({ kind: 'flip', key, flipped: true });
  for (const key of before) if (!after.has(key)) actions.push({ kind: 'flip', key, flipped: false });
  if (all || prev.revealed !== next.revealed) actions.push({ kind: 'reveal', revealed: next.revealed });

  const target = resolveSelection(next.selection, top);
  if (next.selection === 'home') {
    if (all || prev.selection !== 'home') actions.push({ kind: 'home' });
  } else if (all || prev.selection === 'home' || resolveSelection(prev.selection, top) !== target) {
    actions.push({ kind: 'select', target });
  }
  if (all || !sameDrawer(prev.drawer, next.drawer)) actions.push({ kind: 'drawer', drawer: next.drawer });
  if (all || prev.peel !== next.peel) actions.push({ kind: 'peel', to: next.peel });

  if (next.route !== 'workstation' && (all || prev.route !== next.route)) actions.push({ kind: 'route', to: next.route });
  return actions;
}
