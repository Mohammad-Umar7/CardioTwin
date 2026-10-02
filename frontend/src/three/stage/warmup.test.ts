import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Scene, Vector3, type Material, type Object3D, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { warmPrograms } from './warmup';

interface FakeProgram {
  isReady(): boolean;
  getUniforms(): unknown;
}

/**
 * A renderer that records what warmPrograms asks of it: the clipping state a draw leaves behind (the planes of the
 * last material drawn), the render target bound, and one program per material compiled under that state.
 */
function fakeRenderer(pollsUntilReady = 3) {
  const log: string[] = [];
  let target: unknown = null;
  let clipState = -1;
  const programs = new Map<Material, Map<string, FakeProgram>>();
  const firstUses: Material[] = [];
  const gl = {
    localClippingEnabled: true,
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => {
      target = t;
    },
    render: (scene: Object3D) => {
      scene.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        if (m) clipState = m.clippingPlanes?.length ?? 0;
      });
      log.push(`draw clip=${clipState}`);
    },
    compile: (root: Object3D, _camera: unknown, scene: Scene) => {
      const compiled = new Set<Material>();
      root.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        if (!m) return;
        compiled.add(m);
        const planes = m.clippingPlanes?.length ?? 0;
        let byKey = programs.get(m);
        if (!byKey) programs.set(m, (byKey = new Map()));
        let polls = 0;
        byKey.set(`clip${clipState}`, {
          isReady: () => (polls += 1) >= pollsUntilReady,
          getUniforms: () => firstUses.push(m),
        });
        log.push(`compile ${m.name} planes=${planes} state=${clipState} into=${target ? 'target' : 'screen'} env=${scene.name}`);
      });
      return compiled;
    },
    properties: { get: (m: Material) => ({ programs: programs.get(m) }) },
  };
  return { gl: gl as unknown as WebGLRenderer, log, programs, firstUses, target: () => target };
}

function scene() {
  const root = new Scene();
  root.name = 'main';
  const plane = new Plane(new Vector3(0, 0, 1), 0);
  const clipped = new MeshBasicMaterial({ name: 'wall' });
  clipped.clippingPlanes = [plane];
  const plain = new MeshBasicMaterial({ name: 'lung' });
  const ghost = new MeshBasicMaterial({ name: 'ghost' });
  const wall = new Mesh(new BoxGeometry(), clipped);
  wall.add(new Mesh(wall.geometry, ghost)); // a ghost twin under its solid, as the rig builds them
  wall.visible = false; // hidden meshes are warmed too (the anatomy stays hidden until it is warm)
  root.add(wall, new Mesh(new BoxGeometry(), plain), new Mesh(new BoxGeometry(), clipped));
  return root;
}

describe('shader warm-up', () => {
  it('compiles each material once, under its own clipping state, against the real scene', async () => {
    const { gl, log } = fakeRenderer();
    const n = await warmPrograms(gl, scene(), new PerspectiveCamera(), { intoTarget: false });
    expect(n).toBe(3);
    const compiles = log.filter((l) => l.startsWith('compile'));
    expect(compiles).toHaveLength(3);
    for (const line of compiles) {
      const [, planes, state] = /planes=(\d+) state=(\d+)/.exec(line)!;
      expect(state).toBe(planes);
      expect(line).toContain('env=main');
    }
    // each group right after a draw that left its clipping state
    const draws = log.filter((l) => l.startsWith('draw'));
    expect(new Set(draws)).toEqual(new Set(['draw clip=0', 'draw clip=1']));
  });

  it('compiles into a render target while the post chain is on, then restores the bound target', async () => {
    const { gl, log, target } = fakeRenderer();
    const before = { previous: true };
    gl.setRenderTarget(before as never);
    await warmPrograms(gl, scene(), new PerspectiveCamera(), { intoTarget: true });
    expect(log.filter((l) => l.startsWith('compile')).every((l) => l.endsWith('into=target env=main'))).toBe(true);
    expect(target()).toBe(before);
  });

  it('waits for the compiler threads, then takes every first use, reporting progress up to 1', async () => {
    const { gl, firstUses } = fakeRenderer(4);
    const progress: number[] = [];
    await warmPrograms(gl, scene(), new PerspectiveCamera(), { intoTarget: false, onProgress: (k) => progress.push(k) });
    expect(firstUses.map((m) => m.name).sort()).toEqual(['ghost', 'lung', 'wall']);
    expect(progress.at(-1)).toBeCloseTo(1, 9);
    for (let i = 1; i < progress.length; i += 1) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!);
  });

  it('stops when the scene goes away', async () => {
    const { gl, firstUses } = fakeRenderer(1e9);
    let polls = 0;
    await warmPrograms(gl, scene(), new PerspectiveCamera(), { intoTarget: false, cancelled: () => (polls += 1) > 3 });
    expect(firstUses).toHaveLength(0);
  });
});
