/**
 * Picking API (DESIGN_SYSTEM §7.5, §7.9): what is under the pointer and what was last clicked, published by
 * the anatomy's three-mesh-bvh raycaster for the HUD tooltip (D1) and the inspector (C).
 *
 * Discrete fields (structure, segment, territory) change only when the answer changes, so subscribers
 * re-render rarely. The exact face point and its screen position update every pointer move in the mutable
 * `pickPointer` object — read it in rAF / useFrame, never through React state.
 *
 * Risk stays vessel-level: `segment` is an anatomical SCCT label for inspection, never a lesion location.
 */
import { create } from 'zustand';
import type { TargetId } from '@/types/contracts';
import type { SegmentInfo } from '../anatomy/segments';

export interface PickInfo {
  /** Manifest structure id (e.g. "lad", "heart_wall_anterior"), or the node name when unlisted. */
  structureId: string;
  /** GLB node name. */
  node: string;
  /** Human label from the manifest. */
  label: string;
  /** Model target this structure is coloured by (vessels), or null (not predicted / tissue). */
  target: TargetId | null;
  /** Tissue kind (coronary, myocardium, valve, aorta, …). */
  kind: string;
  /** SCCT segment under the pointer (coronaries with `_SEGMENT`), else null. */
  segment: SegmentInfo | null;
  /** Dominant supplied territory under the pointer (myocardium with COLOR_0), else null. */
  territory: 'LAD' | 'LCX' | 'RCA' | null;
  /** World-space face point at the time of the pick. */
  point: [number, number, number];
}

export interface PickState {
  hover: PickInfo | null;
  selected: PickInfo | null;
  setHover(info: PickInfo | null): void;
  setSelected(info: PickInfo | null): void;
}

const same = (a: PickInfo | null, b: PickInfo | null) =>
  a === b || (!!a && !!b && a.node === b.node && a.segment?.scct === b.segment?.scct && a.territory === b.territory);

export const usePickStore = create<PickState>()((set, get) => ({
  hover: null,
  selected: null,
  setHover: (hover) => {
    if (!same(get().hover, hover)) set({ hover });
  },
  setSelected: (selected) => set({ selected }),
}));

/** Latest pointer hit, updated on every move (mutable; read per frame). */
export const pickPointer = {
  /** World-space point on the surface, or null when nothing is under the pointer. */
  point: null as [number, number, number] | null,
  /** CSS pixels relative to the canvas. */
  screen: null as [number, number] | null,
  /** performance.now() of the last update. */
  at: 0,
};
