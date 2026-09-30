import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { coronaryMeshes } from './bloomSelection';

const mesh = (name: string) => {
  const m = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  m.name = name;
  return m;
};

describe('bloom selection', () => {
  it('selects every mesh of the coronary tree and nothing else', () => {
    const root = new Group();
    const coronary = new Group();
    coronary.name = 'Layer_Coronary';
    const lad = mesh('Coronary_LAD');
    const rcaGroup = new Group();
    rcaGroup.name = 'Coronary_RCA';
    const rcaTube = mesh('tube');
    rcaGroup.add(rcaTube);
    coronary.add(lad, rcaGroup);
    const wall = mesh('Heart_Wall_Anterior');
    const fxTwin = mesh('FX_Overlay_Coronary_LAD');
    fxTwin.userData.ctFx = true;
    lad.add(fxTwin);
    root.add(coronary, wall);
    const selected = coronaryMeshes(root);
    expect(selected).toContain(lad);
    expect(selected).toContain(rcaTube);
    expect(selected).not.toContain(wall);
    expect(selected).not.toContain(fxTwin);
    expect(selected).toHaveLength(2);
  });
});
