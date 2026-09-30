/**
 * SCCT coronary segments and supplied territories under the cursor (pure; unit tested in segments.test.ts).
 *
 * CONTRACTS §7.1: coronary meshes MAY carry a scalar vertex attribute `_SEGMENT` (three.js:
 * `geometry.attributes._segment`) holding the SCCT segment number (1–18, 0 = unassigned), and the manifest
 * MAY list `segments[]` with codes, names and definitions. Risk stays VESSEL-level: a segment is an
 * anatomical label for inspection, never a lesion location.
 */
import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three';

export interface SegmentInfo {
  scct: number;
  code: string;
  name: string;
  /** Anatomical vessel the segment belongs to (LM and ramus are not model targets). */
  vessel: 'LM' | 'LAD' | 'LCX' | 'RCA' | 'Ramus';
  /** Model target that colours it, or null when not predicted. */
  target: 'LAD' | 'LCX' | 'RCA' | null;
  definition?: string;
  source?: string;
}

/** SCCT 2014 (Leipsic et al.) 18-segment model — used when the manifest carries no `segments`. */
export const SCCT_SEGMENTS: readonly SegmentInfo[] = [
  { scct: 1, code: 'pRCA', name: 'Proximal RCA', vessel: 'RCA', target: 'RCA' },
  { scct: 2, code: 'mRCA', name: 'Mid RCA', vessel: 'RCA', target: 'RCA' },
  { scct: 3, code: 'dRCA', name: 'Distal RCA', vessel: 'RCA', target: 'RCA' },
  { scct: 4, code: 'R-PDA', name: 'Posterior descending (from RCA)', vessel: 'RCA', target: 'RCA' },
  { scct: 5, code: 'LM', name: 'Left main', vessel: 'LM', target: null },
  { scct: 6, code: 'pLAD', name: 'Proximal LAD', vessel: 'LAD', target: 'LAD' },
  { scct: 7, code: 'mLAD', name: 'Mid LAD', vessel: 'LAD', target: 'LAD' },
  { scct: 8, code: 'dLAD', name: 'Distal LAD', vessel: 'LAD', target: 'LAD' },
  { scct: 9, code: 'D1', name: 'First diagonal', vessel: 'LAD', target: 'LAD' },
  { scct: 10, code: 'D2', name: 'Second diagonal', vessel: 'LAD', target: 'LAD' },
  { scct: 11, code: 'pCx', name: 'Proximal circumflex', vessel: 'LCX', target: 'LCX' },
  { scct: 12, code: 'OM1', name: 'First obtuse marginal', vessel: 'LCX', target: 'LCX' },
  { scct: 13, code: 'LCx', name: 'Mid / distal circumflex', vessel: 'LCX', target: 'LCX' },
  { scct: 14, code: 'OM2', name: 'Second obtuse marginal', vessel: 'LCX', target: 'LCX' },
  { scct: 15, code: 'L-PDA', name: 'Posterior descending (from LCx)', vessel: 'LCX', target: 'LCX' },
  { scct: 16, code: 'R-PLB', name: 'Posterolateral branch (from RCA)', vessel: 'RCA', target: 'RCA' },
  { scct: 17, code: 'RI', name: 'Ramus intermedius', vessel: 'Ramus', target: null },
  { scct: 18, code: 'L-PLB', name: 'Posterolateral branch (from LCx)', vessel: 'LCX', target: 'LCX' },
];

const TARGETS = new Set(['LAD', 'LCX', 'RCA']);
const VESSELS = new Set(['LM', 'LAD', 'LCX', 'RCA', 'Ramus']);

/** Manifest `segments[]` (untyped additive field) → SegmentInfo by SCCT number; the SCCT table fills gaps. */
export function segmentTable(manifestSegments: unknown): Map<number, SegmentInfo> {
  const table = new Map(SCCT_SEGMENTS.map((s) => [s.scct, s] as const));
  if (!Array.isArray(manifestSegments)) return table;
  for (const raw of manifestSegments as Record<string, unknown>[]) {
    const scct = typeof raw?.scct === 'number' ? raw.scct : NaN;
    if (!Number.isInteger(scct) || scct <= 0) continue;
    const base = table.get(scct);
    const vessel = typeof raw.vessel === 'string' && VESSELS.has(raw.vessel) ? (raw.vessel as SegmentInfo['vessel']) : base?.vessel ?? 'LM';
    const target =
      raw.target === null ? null : typeof raw.target === 'string' && TARGETS.has(raw.target) ? (raw.target as SegmentInfo['target']) : base?.target ?? null;
    table.set(scct, {
      scct,
      code: typeof raw.code === 'string' ? raw.code : base?.code ?? `S${scct}`,
      name: typeof raw.name === 'string' ? raw.name : base?.name ?? `Segment ${scct}`,
      vessel,
      target,
      definition: typeof raw.definition === 'string' ? raw.definition : base?.definition,
      source: typeof raw.source === 'string' ? raw.source : base?.source,
    });
  }
  return table;
}

type ScalarAttribute = Pick<BufferAttribute | InterleavedBufferAttribute, 'getX' | 'count'>;

/** Vertex indices of triangle `face` (indexed or not). */
export function faceVertices(geometry: Pick<BufferGeometry, 'index'>, face: number): [number, number, number] {
  const index = geometry.index;
  if (index) return [index.getX(face * 3), index.getX(face * 3 + 1), index.getX(face * 3 + 2)];
  return [face * 3, face * 3 + 1, face * 3 + 2];
}

/**
 * SCCT number of the triangle under the cursor: the value shared by at least two of its vertices; when all
 * three differ (a segment boundary), the vertex with the largest barycentric weight wins. 0 = unassigned.
 */
export function segmentAtFace(
  geometry: Pick<BufferGeometry, 'index'>,
  segment: ScalarAttribute,
  face: number,
  barycentric?: readonly [number, number, number],
): number {
  const [a, b, c] = faceVertices(geometry, face);
  if (Math.max(a, b, c) >= segment.count) return 0;
  const sa = Math.round(segment.getX(a));
  const sb = Math.round(segment.getX(b));
  const sc = Math.round(segment.getX(c));
  if (sa === sb || sa === sc) return sa;
  if (sb === sc) return sb;
  if (barycentric) {
    const [wa, wb, wc] = barycentric;
    return wa >= wb && wa >= wc ? sa : wb >= wc ? sb : sc;
  }
  return sa;
}

type ColorAttribute = Pick<BufferAttribute | InterleavedBufferAttribute, 'getX' | 'getY' | 'getZ' | 'count'>;

/**
 * Dominant supplied territory at a myocardium triangle from `COLOR_0` (R = LAD, G = LCX, B = RCA; the
 * remainder is "neutral"). Null when the neutral share dominates (atria, great-vessel roots).
 */
export function territoryAtFace(
  geometry: Pick<BufferGeometry, 'index'>,
  weights: ColorAttribute,
  face: number,
  minWeight = 0.3,
): 'LAD' | 'LCX' | 'RCA' | null {
  const verts = faceVertices(geometry, face);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const v of verts) {
    if (v >= weights.count) return null;
    r += weights.getX(v);
    g += weights.getY(v);
    b += weights.getZ(v);
  }
  r /= 3;
  g /= 3;
  b /= 3;
  const max = Math.max(r, g, b);
  if (max < minWeight) return null;
  return max === r ? 'LAD' : max === g ? 'LCX' : 'RCA';
}
