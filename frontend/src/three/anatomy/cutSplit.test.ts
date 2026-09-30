import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { baseNode, cutSide, nodeAt, splitSegments } from './cutSplit';

const cut = { cutPoint: new Vector3(0, 0, 0), cutNormal: new Vector3(0, 0, 1) };

describe('cut-plane split helpers', () => {
  it('names the part of a split vessel that carries a point', () => {
    expect(cutSide(cut, [0, 0, 0.2])).toBeCloseTo(0.2);
    expect(nodeAt(cut, 'Coronary_LAD', [0, 0, 0.1])).toBe('Coronary_LAD_Anterior');
    expect(nodeAt(cut, 'Coronary_LAD', [0, 0, -0.1])).toBe('Coronary_LAD');
    // Not split: the node itself, whatever the side.
    expect(nodeAt(cut, 'Coronary_LCX', [0, 0, 0.1])).toBe('Coronary_LCX');
    expect(nodeAt(null, 'Coronary_LAD', [0, 0, 0.1])).toBe('Coronary_LAD');
  });

  it('maps a split part back to its source node and leaves the heart walls alone', () => {
    expect(baseNode('Coronary_LAD_Anterior')).toBe('Coronary_LAD');
    expect(baseNode('CardiacVeins_Anterior')).toBe('CardiacVeins');
    expect(baseNode('Heart_Wall_Anterior')).toBe('Heart_Wall_Anterior');
    expect(baseNode('EpicardialFat_Anterior')).toBe('EpicardialFat_Anterior');
  });

  it('splits a centreline into one-sided runs that meet at the plane', () => {
    const points = [
      [0, 0, -0.2],
      [0, 0, -0.1],
      [0, 0, 0.1],
      [0, 0, 0.2],
      [0, 0, -0.05],
      [0, 0, -0.15],
    ];
    const { back, front } = splitSegments(cut, [{ points, radius: [1, 2, 3, 4, 5, 6] }]);
    expect(back.map((r) => r.points.length)).toEqual([2, 3]);
    expect(front.map((r) => r.points.length)).toEqual([3]);
    // The front run starts on the last posterior point, so the two proxies touch.
    expect(front[0]!.points[0]).toBe(points[1]);
    expect(front[0]!.radius).toEqual([2, 3, 4]);
    expect(back[1]!.points[0]).toBe(points[3]);
  });
});
