/**
 * GLB node → tissue kind (pure; unit tested in anatomy.test.ts). The kind decides the material family in
 * both looks, how the heartbeat applies, whether the node is pickable and which assembly stage flies it in.
 * Names follow CONTRACTS §6.2; unknown nodes fall back to their layer.
 */
import type { AssemblyStageId } from './assembly';
import { BEAT_MODE } from './beatDeform';

export type TissueKind =
  | 'myocardium'
  | 'coronary'
  | 'leftMain'
  | 'aorta'
  | 'pulmonaryArtery'
  | 'pulmonaryVeins'
  | 'systemicVein'
  | 'cardiacVein'
  /** Epicardial fat in the AV / interventricular grooves: beats and explodes with its wall, never picked. */
  | 'fat'
  | 'valve'
  | 'papillary'
  | 'bone'
  | 'cartilage'
  | 'lung'
  | 'airway'
  | 'oesophagus'
  | 'skin'
  | 'muscle'
  | 'diaphragm'
  | 'other';

const RULES: readonly [RegExp, TissueKind][] = [
  [/^Heart_Wall/, 'myocardium'],
  [/^Coronary_LM$/, 'leftMain'],
  [/^Coronary_/, 'coronary'],
  [/^GreatVessel_Aorta/, 'aorta'],
  [/^GreatVessel_PulmonaryArtery/, 'pulmonaryArtery'],
  [/^GreatVessel_PulmonaryVeins/, 'pulmonaryVeins'],
  [/^GreatVessel_(SVC|IVC)/, 'systemicVein'],
  [/^CardiacVeins/, 'cardiacVein'],
  [/^EpicardialFat/, 'fat'],
  [/^Valve_/, 'valve'],
  [/^Papillary/, 'papillary'],
  [/^CostalCartilage/, 'cartilage'],
  [/^(Ribs|Sternum|Clavicle|Spine)/, 'bone'],
  [/^Lung_/, 'lung'],
  [/^Trachea/, 'airway'],
  [/^Oesophagus/, 'oesophagus'],
  [/^Skin/, 'skin'],
  [/^Pectoralis/, 'muscle'],
  [/^Diaphragm/, 'diaphragm'],
];

const LAYER_FALLBACK: Readonly<Record<string, TissueKind>> = {
  Layer_Skin: 'skin',
  Layer_Muscle: 'muscle',
  Layer_Skeleton: 'bone',
  Layer_Lungs: 'lung',
  Layer_Diaphragm: 'diaphragm',
  Layer_Coronary: 'coronary',
  Layer_Heart: 'myocardium',
};

export function classifyNode(name: string, layerNode = ''): TissueKind {
  for (const [re, kind] of RULES) if (re.test(name)) return kind;
  return LAYER_FALLBACK[layerNode] ?? 'other';
}

/** Kinds that live inside the heart group and ride its affine beat through their node matrix. */
export const BEATS_WITH_HEART: ReadonlySet<TissueKind> = new Set(['myocardium', 'coronary', 'leftMain', 'valve', 'papillary', 'cardiacVein', 'fat']);

/** Vertex-shader beat mode for a kind (see beatDeform.ts). */
export function beatModeOf(kind: TissueKind): number {
  if (BEATS_WITH_HEART.has(kind)) return BEAT_MODE.atrial;
  if (kind === 'aorta' || kind === 'pulmonaryArtery' || kind === 'pulmonaryVeins' || kind === 'systemicVein') return BEAT_MODE.root;
  return BEAT_MODE.none;
}

/** Outer layers: rendered as ghosts once peeled, never pickable. */
export const OUTER_KINDS: ReadonlySet<TissueKind> = new Set(['skin', 'muscle', 'bone', 'cartilage', 'lung', 'airway', 'oesophagus', 'diaphragm']);

/**
 * Kinds that answer the pointer (vessels first; the wall reports its supplied territory). Epicardial fat is
 * deliberately absent: it wraps the arteries in their grooves, so a click aimed at the LAD must pass through
 * it to the vessel (and its proxy tube) underneath.
 */
export const PICKABLE_KINDS: ReadonlySet<TissueKind> = new Set([
  'coronary',
  'leftMain',
  'myocardium',
  'valve',
  'papillary',
  'aorta',
  'pulmonaryArtery',
  'pulmonaryVeins',
  'systemicVein',
  'cardiacVein',
]);

/** Pulmonary trees are clipped to a sphere around the heart (V2 §5.15). */
export const CLIPPED_TREE_KINDS: ReadonlySet<TissueKind> = new Set(['pulmonaryArtery', 'pulmonaryVeins']);

/** Assembly stage that flies a node in. */
export function assemblyStageOf(kind: TissueKind, node: string): AssemblyStageId {
  switch (kind) {
    case 'skin':
      return 'skin';
    case 'muscle':
      return 'muscle';
    case 'bone':
    case 'cartilage':
      return 'skeleton';
    case 'lung':
    case 'airway':
    case 'oesophagus':
      return 'lungs';
    case 'diaphragm':
      return 'diaphragm';
    case 'aorta':
    case 'pulmonaryArtery':
    case 'pulmonaryVeins':
    case 'systemicVein':
      return 'greatVessels';
    case 'coronary':
    case 'leftMain':
      return 'coronary';
    default:
      return /Anterior/.test(node) ? 'heartAnterior' : 'heartPosterior';
  }
}
