import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Matrix4, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnatomyManifest, VesselsFile } from '@/types/contracts';
import { VISIBLE_FACING, trunkVisibility, visibleBestView } from '../camera/bestView';
import { bestViewFor, toControlsAngles } from '../camera/presets';
import { buildTracks, heartAxisFrame, restToDisplayed } from './anchorTracks';
import { clip, hoverContent } from './hoverContent';
import { ANCHOR_PERIOD_MS, AnchorChooser, bestCandidate, buildCandidates, facing, mainTrunk } from './dynamicAnchor';
import { LABEL_MIN_GAP, labelShowsProbability, laneFor, layoutLanes, stackLane, type LaneItem } from './labelRegistry';

const read = <T,>(file: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../public/anatomy', file), 'utf8')) as T;
const manifest = read<AnatomyManifest>('manifest.json');
const vessels = read<VesselsFile>('vessels.json');

const eyeFor = (azimuth: number, elevation: number, distance: number) => {
  const { azimuth: a, polar } = toControlsAngles(azimuth, elevation);
  return new Vector3().setFromSphericalCoords(distance, polar, a);
};

describe('dynamic label anchors (V2 §5.14, P0-2)', () => {
  const tracks = buildTracks(manifest, vessels, ['LAD', 'LCX', 'RCA']);

  it('builds proximal–mid candidates for every vessel from its main trunk', () => {
    expect(tracks.map((t) => t.target)).toEqual(['LAD', 'LCX', 'RCA']);
    for (const t of tracks) {
      expect(t.candidates.length).toBeGreaterThanOrEqual(8);
      expect(t.candidates[0]!.u).toBeGreaterThan(0);
      expect(t.candidates[t.candidates.length - 1]!.u).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(t.centre).not.toBeNull();
      for (const c of t.candidates) expect(c.normal.length()).toBeCloseTo(1, 5);
    }
  });

  // The P0-2 acceptance check: at each vessel's best view there is a camera-facing stretch of its trunk,
  // so the selected label always points at something the viewer can see.
  for (const target of ['LAD', 'LCX', 'RCA']) {
    it(`finds a camera-facing ${target} segment at its (visible) best view`, () => {
      const track = tracks.find((t) => t.target === target)!;
      const conventional = bestViewFor(target, manifest.structures.find((s) => s.target === target && s.bestView)?.bestView);
      const view = visibleBestView(conventional, track.candidates);
      const eye = eyeFor(view.azimuth, view.elevation, view.distance);
      const scores = track.candidates.map((c) => facing(c.rest, c.normal, eye));
      const best = bestCandidate(scores);
      expect(scores[best]!).toBeGreaterThan(0.3);
      expect(trunkVisibility(track.candidates, view).score).toBeGreaterThanOrEqual(VISIBLE_FACING);
      expect(Math.abs(view.elevation)).toBeLessThanOrEqual(30);
    });
  }

  it('keeps the conventional angiographic view whenever the trunk is visible from it', () => {
    const lad = tracks.find((t) => t.target === 'LAD')!;
    const conventional = { azimuth: -30, elevation: 25, distance: 3.3 };
    expect(visibleBestView(conventional, lad.candidates)).toBe(conventional);
    // The LCX runs in the posterior AV groove: hidden from RAO 30 / CAU 25 in a surface rendering.
    const lcx = tracks.find((t) => t.target === 'LCX')!;
    const moved = visibleBestView({ azimuth: -30, elevation: -25, distance: 3.3 }, lcx.candidates);
    expect(moved.azimuth).toBeGreaterThan(0); // left anterior / lateral oblique
    console.info('LCX visible best view', moved);
  });

  it('keeps a front-facing anchor for LAD and RCA at the anterior home pose', () => {
    const eye = new Vector3(...(manifest.camera.heart!.position as [number, number, number]));
    for (const target of ['LAD', 'RCA']) {
      const track = tracks.find((t) => t.target === target)!;
      const scores = track.candidates.map((c) => facing(c.rest, c.normal, eye));
      expect(Math.max(...scores)).toBeGreaterThan(0.3);
    }
  });

  it('points the outward normals away from the heart axis', () => {
    const frame = heartAxisFrame(manifest);
    const trunk = mainTrunk(vessels.vessels.find((v) => v.id === 'LAD')!.segments as never);
    for (const c of buildCandidates(trunk, frame)) {
      const rel = c.rest.clone().sub(frame.centre);
      rel.addScaledVector(frame.axis, -rel.dot(frame.axis));
      expect(c.normal.dot(rel.normalize())).toBeGreaterThan(0.5);
    }
  });

  it('switches only after a better candidate stays best for 200 ms, and ignores small gains', () => {
    const chooser = new AnchorChooser();
    let scores = [0.9, 0.2, 0.1];
    expect(chooser.update(0, () => scores)).toBe(0);
    scores = [0.5, 0.52, 0.1]; // better by less than the margin: stays
    expect(chooser.update(ANCHOR_PERIOD_MS, () => scores)).toBe(0);
    scores = [0.1, 0.9, 0.2]; // clearly better: pending first
    expect(chooser.update(2 * ANCHOR_PERIOD_MS, () => scores)).toBe(0);
    expect(chooser.update(2 * ANCHOR_PERIOD_MS + 50, () => scores)).toBe(0); // not re-evaluated yet
    expect(chooser.update(3 * ANCHOR_PERIOD_MS, () => scores)).toBe(1);
    // A flicker that does not last is ignored.
    scores = [0.95, 0.1, 0.1];
    expect(chooser.update(4 * ANCHOR_PERIOD_MS, () => scores)).toBe(1);
    scores = [0.1, 0.9, 0.1];
    expect(chooser.update(5 * ANCHOR_PERIOD_MS, () => scores)).toBe(1);
  });

  it('follows the peel and assembly transform but not the heartbeat', () => {
    const centre = new Vector3(0.3, -0.1, 0.2);
    const e = new Matrix4().makeTranslation(0.5, 0, 0);
    const beat = new Matrix4().makeScale(1.05, 0.95, 1.05);
    const mesh = new Object3D();
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(e).multiply(beat).multiply(new Matrix4().makeTranslation(centre.x, centre.y, centre.z));
    const parent = new Object3D();
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    const m = restToDisplayed(mesh, centre, beat);
    const p = new Vector3(0.4, 0.1, 0.3).applyMatrix4(m);
    expect(p.x).toBeCloseTo(0.9, 6);
    expect(p.y).toBeCloseTo(0.1, 6);
    expect(p.z).toBeCloseTo(0.3, 6);
  });
});

describe('label lanes (V2 §5.14)', () => {
  const bounds = { left: 304, right: 1064, top: 56, bottom: 760 };
  const item = (id: string, x: number, y: number, lane: 'left' | 'right'): LaneItem => ({ id, lane, x, y, width: 64, height: 24 });

  it('keeps every label inside the free area, next to the heart, never overlapping', () => {
    const items = [item('RCA', 560, 380, 'left'), item('LAD', 760, 300, 'right'), item('LCX', 800, 310, 'right')];
    const placed = layoutLanes(items, bounds, { minX: 480, maxX: 900 });
    for (const [, p] of placed) {
      expect(p.left).toBeGreaterThanOrEqual(bounds.left);
      expect(p.left + 64).toBeLessThanOrEqual(bounds.right);
      expect(p.top).toBeGreaterThanOrEqual(bounds.top);
      expect(p.top + 24).toBeLessThanOrEqual(bounds.bottom);
    }
    const lad = placed.get('LAD')!;
    const lcx = placed.get('LCX')!;
    expect(Math.abs(lad.edgeY - lcx.edgeY)).toBeGreaterThanOrEqual(LABEL_MIN_GAP);
    expect(lad.edgeY).toBeLessThan(lcx.edgeY); // anchor order kept → leaders do not cross
    expect(placed.get('RCA')!.edgeX).toBe(480 - 28); // right-aligned against the heart
    expect(lad.edgeX).toBe(900 + 28);
  });

  it('clamps to the free-area edge when the heart fills it', () => {
    const placed = layoutLanes([item('LAD', 1000, 20, 'right')], bounds, { minX: 300, maxX: 1100 });
    const p = placed.get('LAD')!;
    expect(p.left + 64).toBeLessThanOrEqual(bounds.right - 12);
    expect(p.top).toBeGreaterThanOrEqual(bounds.top + 12);
  });

  it('stacks by anchor order and pushes back up at the bottom', () => {
    const ys = stackLane(
      [
        { id: 'a', y: 700 },
        { id: 'b', y: 705 },
      ],
      28,
      0,
      710,
    );
    expect(ys.get('b')! - ys.get('a')!).toBe(28);
    expect(ys.get('b')).toBe(710);
  });

  it('follows the radiological convention and swaps behind the patient', () => {
    expect(laneFor('RCA', 0)).toBe('left');
    expect(laneFor('LAD', 30)).toBe('right');
    expect(laneFor('RCA', 170)).toBe('right');
  });

  it('shows the % only where the Risk card is hidden (one home per number)', () => {
    expect(labelShowsProbability('workstation')).toBe(false);
    expect(labelShowsProbability('tour')).toBe(false);
    expect(labelShowsProbability('focus')).toBe(true);
    expect(labelShowsProbability('landing')).toBe(true);
  });
});

describe('hover tooltip content (V2 §9.3 D, CONTRACTS §7.1)', () => {
  const base = { structureId: 'lad', node: 'Coronary_LAD', label: 'LAD', target: 'LAD' as const, kind: 'coronary', segment: null, territory: null, point: [0, 0, 0] as [number, number, number] };

  it('names the SCCT segment and keeps risk vessel-level', () => {
    const c = hoverContent(
      { ...base, segment: { scct: 7, code: 'mLAD', name: 'Mid LAD', vessel: 'LAD', target: 'LAD', definition: 'From D1 to D2' } },
      manifest,
    );
    expect(c.title).toBe('Left anterior descending (LAD)');
    expect(c.segment).toBe('Segment 7 · Mid LAD (mLAD)');
    expect(c.definition).toBe('From D1 to D2');
    expect(c.note).toMatch(/risk is estimated for the whole LAD/);
    expect(`${c.title} ${c.segment} ${c.definition} ${c.note}`).not.toMatch(/lesion|stenosis at|diagnos/i);
  });

  it('cuts long definitions at a clause, never mid-phrase', () => {
    const long = `${'The artery runs in the anterior groove to the apex'.padEnd(80, ' x')}; SCCT 6 is proximal (to D1), 7 mid (to D2) and 8 distal ${'y'.repeat(200)}`;
    const c = clip(long)!;
    expect(c.endsWith('.')).toBe(true);
    expect(c.length).toBeLessThanOrEqual(221);
    expect(clip('short')).toBe('short');
  });

  it('falls back to the structure description, and explains territories', () => {
    const plain = hoverContent(base, manifest);
    expect(plain.definition && plain.definition.length).toBeGreaterThan(10);
    expect(plain.definition!.length).toBeLessThanOrEqual(221);
    const wall = hoverContent({ ...base, structureId: 'heart_wall_anterior', node: 'Heart_Wall_Anterior', kind: 'myocardium', target: null, territory: 'RCA' }, manifest);
    expect(wall.definition).toBe('Supplied mostly by the right coronary artery (RCA).');
    expect(wall.note).toMatch(/not a perfusion scan/);
    const lm = hoverContent({ ...base, structureId: 'lm', node: 'Coronary_LM', kind: 'leftMain', target: null }, manifest);
    expect(lm.note).toMatch(/not predicted/);
  });
});
