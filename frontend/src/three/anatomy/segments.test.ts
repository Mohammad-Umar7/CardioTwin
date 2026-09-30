import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { SCCT_SEGMENTS, faceVertices, segmentAtFace, segmentTable, territoryAtFace } from './segments';

function indexed(indices: number[], vertexCount: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(vertexCount * 3), 3));
  g.setIndex(indices);
  return g;
}

describe('SCCT segment table', () => {
  it('has the 18 SCCT 2014 segments with the LAD / LCX / RCA mapping of the model targets', () => {
    expect(SCCT_SEGMENTS).toHaveLength(18);
    expect(SCCT_SEGMENTS.map((s) => s.scct)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    const t = segmentTable(undefined);
    expect(t.get(7)).toMatchObject({ code: 'mLAD', target: 'LAD' });
    expect(t.get(13)).toMatchObject({ code: 'LCx', target: 'LCX' });
    expect(t.get(1)).toMatchObject({ code: 'pRCA', target: 'RCA' });
    // Left main and ramus are anatomical labels only: never a model target.
    expect(t.get(5)!.target).toBeNull();
    expect(t.get(17)!.target).toBeNull();
  });

  it('merges manifest segments (names, definitions) over the defaults and ignores junk', () => {
    const t = segmentTable([
      { scct: 7, code: 'mLAD', name: 'Mid LAD', vessel: 'LAD', target: 'LAD', definition: 'From D1 to D2', source: 'SCCT 2014' },
      { scct: 'x' },
      null,
      { scct: 19, code: 'X', name: 'Extra', vessel: 'nonsense', target: 'nonsense' },
    ]);
    expect(t.get(7)!.definition).toBe('From D1 to D2');
    expect(t.get(19)).toMatchObject({ code: 'X', vessel: 'LM', target: null });
    expect(t.size).toBe(19);
  });
});

describe('segment under the cursor', () => {
  // Two triangles: face 0 = (0,1,2) all segment 6; face 1 = (2,3,4) → 6, 7, 7.
  const geometry = indexed([0, 1, 2, 2, 3, 4], 6);
  const segment = new BufferAttribute(new Float32Array([6, 6, 6, 7, 7, 8]), 1);

  it('resolves the triangle vertices of indexed and non-indexed geometry', () => {
    expect(faceVertices(geometry, 1)).toEqual([2, 3, 4]);
    expect(faceVertices(new BufferGeometry(), 2)).toEqual([6, 7, 8]);
  });

  it('takes the value shared by two or three vertices', () => {
    expect(segmentAtFace(geometry, segment, 0)).toBe(6);
    expect(segmentAtFace(geometry, segment, 1)).toBe(7);
  });

  it('breaks a three-way boundary with the barycentric weights', () => {
    const g = indexed([0, 3, 5], 6);
    expect(segmentAtFace(g, segment, 0, [0.1, 0.2, 0.7])).toBe(8);
    expect(segmentAtFace(g, segment, 0, [0.6, 0.2, 0.2])).toBe(6);
    expect(segmentAtFace(g, segment, 0)).toBe(6);
  });

  it('returns 0 (unassigned) for out-of-range faces', () => {
    expect(segmentAtFace(indexed([0, 1, 9], 10), segment, 0)).toBe(0);
  });
});

describe('supplied territory under the cursor', () => {
  const geometry = indexed([0, 1, 2, 3, 4, 5], 6);
  const weights = new BufferAttribute(
    new Float32Array([
      0.9, 0.05, 0, 0.8, 0.1, 0.05, 0.7, 0.2, 0, // LAD-dominant face
      0.05, 0.05, 0.1, 0.1, 0.05, 0.1, 0, 0.1, 0.05, // neutral (atria)
    ]),
    3,
  );
  it('reports the dominant territory, or none where the neutral weight dominates', () => {
    expect(territoryAtFace(geometry, weights, 0)).toBe('LAD');
    expect(territoryAtFace(geometry, weights, 1)).toBeNull();
  });
});
