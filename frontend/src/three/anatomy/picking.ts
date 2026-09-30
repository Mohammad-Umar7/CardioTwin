/**
 * Picking (DESIGN_SYSTEM §7.5): three-mesh-bvh raycasts against the heart wall, valves, great vessels and
 * — for the coronaries — invisible proxy tubes at 3× lumen radius built from `vessels.json`, so thin
 * distal branches are easy to hit. BVHs are built lazily in idle time (a 55k-triangle wall takes tens of
 * milliseconds), one geometry per slice, and raycasts before that fall back to three's brute force.
 *
 * What is under the pointer resolves to a PickInfo: structure, target, SCCT segment (`_SEGMENT`, via the
 * closest point on the real vessel mesh when the proxy was hit) and the supplied territory (COLOR_0).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Triangle,
  Vector3,
  type Intersection,
  type Object3D,
  type Raycaster,
} from 'three';
import { MeshBVH, acceleratedRaycast, type HitPointInfo } from 'three-mesh-bvh';
import type { PickInfo } from '../stage/pickStore';
import type { RigEntry } from './rig';
import { segmentAtFace, segmentTable, territoryAtFace, type SegmentInfo } from './segments';

/** Proxy tube radius = max(3 × lumen radius, floor) — LUMEN §10: "3D hit tubes are 3× vessel radius". */
export const PROXY_SCALE = 3;
export const PROXY_MIN_RADIUS = 0.016;
const PROXY_SIDES = 6;

export interface CentrelineLike {
  node: string;
  segments: readonly { points: readonly (readonly number[])[]; radius?: readonly number[] }[];
}

/**
 * A light tube around each centreline segment (rest frame → the node's local frame by `restOffset`).
 * Parallel-transported rings keep it twist-free; ≈ 12 triangles per centreline point.
 */
export function buildProxyGeometry(segments: CentrelineLike['segments'], restOffset: Vector3): BufferGeometry | null {
  const positions: number[] = [];
  const indices: number[] = [];
  const t = new Vector3();
  const n = new Vector3();
  const b = new Vector3();
  const p = new Vector3();
  for (const seg of segments) {
    const pts = seg.points;
    if (pts.length < 2) continue;
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[Math.max(0, i - 1)]!;
      const c = pts[Math.min(pts.length - 1, i + 1)]!;
      t.set(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!).normalize();
      if (i === 0) {
        n.set(0, 1, 0);
        if (Math.abs(n.dot(t)) > 0.9) n.set(1, 0, 0);
        n.addScaledVector(t, -n.dot(t)).normalize();
      } else {
        // Parallel transport: remove the component along the new tangent.
        n.addScaledVector(t, -n.dot(t));
        if (n.lengthSq() < 1e-10) n.set(0, 0, 1).addScaledVector(t, -t.z);
        n.normalize();
      }
      b.crossVectors(t, n).normalize();
      const r = Math.max(PROXY_SCALE * (seg.radius?.[i] ?? 0.004), PROXY_MIN_RADIUS);
      const q = pts[i]!;
      for (let k = 0; k < PROXY_SIDES; k += 1) {
        const ang = (k / PROXY_SIDES) * Math.PI * 2;
        p.set(q[0]!, q[1]!, q[2]!)
          .addScaledVector(n, Math.cos(ang) * r)
          .addScaledVector(b, Math.sin(ang) * r)
          .sub(restOffset);
        positions.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < pts.length - 1; i += 1) {
      for (let k = 0; k < PROXY_SIDES; k += 1) {
        const a0 = base + i * PROXY_SIDES + k;
        const a1 = base + i * PROXY_SIDES + ((k + 1) % PROXY_SIDES);
        const b0 = a0 + PROXY_SIDES;
        const b1 = a1 + PROXY_SIDES;
        indices.push(a0, b0, a1, a1, b0, b1);
      }
    }
  }
  if (positions.length === 0) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const proxyMaterial = new MeshBasicMaterial({ visible: false });
const tmpLocal = new Vector3();
const tmpTri = new Triangle();
const tmpBary = new Vector3();
const hitInfo: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };

type IdleHandle = { cancel(): void };

function idle(cb: () => void): IdleHandle {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(cb, { timeout: 500 });
    return { cancel: () => w.cancelIdleCallback?.(id) };
  }
  const id = setTimeout(cb, 16);
  return { cancel: () => clearTimeout(id) };
}

export class Picker {
  private readonly proxies: Mesh[] = [];
  private readonly segments: Map<number, SegmentInfo>;
  private pending: IdleHandle | null = null;
  private disposed = false;

  constructor(
    private readonly entries: readonly RigEntry[],
    manifestSegments: unknown,
    vessels: readonly CentrelineLike[] | null,
  ) {
    this.segments = segmentTable(manifestSegments);
    for (const entry of entries) {
      if (!['coronary', 'leftMain', 'myocardium', 'valve', 'papillary', 'aorta', 'pulmonaryArtery', 'pulmonaryVeins', 'systemicVein'].includes(entry.kind)) continue;
      const mesh = entry.mesh;
      mesh.userData.ctEntry = entry.node;
      mesh.raycast = function raycast(this: Mesh, raycaster: Raycaster, hits: Intersection[]) {
        if (entry.pickable) acceleratedRaycast.call(this, raycaster, hits);
      };
    }
    // Proxy tubes: children of their vessel node, so they explode, hinge and beat with it.
    for (const v of vessels ?? []) {
      const entry = entries.find((e) => e.node === v.node);
      if (!entry || (entry.kind !== 'coronary' && entry.kind !== 'leftMain')) continue;
      const geometry = buildProxyGeometry(v.segments, entry.restOffset);
      if (!geometry) continue;
      geometry.boundsTree = new MeshBVH(geometry);
      const proxy = new Mesh(geometry, proxyMaterial);
      proxy.name = `${entry.node}__pick`;
      proxy.userData.ctGhost = true;
      proxy.userData.ctEntry = entry.node;
      proxy.userData.ctProxy = true;
      proxy.userData.ctTarget = entry.target;
      proxy.renderOrder = -10;
      proxy.raycast = function raycast(this: Mesh, raycaster: Raycaster, hits: Intersection[]) {
        if (entry.pickable) acceleratedRaycast.call(this, raycaster, hits);
      };
      entry.mesh.add(proxy);
      this.proxies.push(proxy);
    }
  }

  /** Build the BVHs of the real meshes in idle slices (vessels first: they are hovered most). */
  scheduleBvh(): void {
    const queue = [...this.entries]
      .filter((e) => typeof e.mesh.userData.ctEntry === 'string' && !(e.mesh.geometry as BufferGeometry).boundsTree)
      .sort((a, b) => Number(b.kind === 'coronary') - Number(a.kind === 'coronary'));
    const step = () => {
      if (this.disposed) return;
      const next = queue.shift();
      if (!next) {
        this.pending = null;
        return;
      }
      const g = next.mesh.geometry as BufferGeometry;
      if (!g.boundsTree) g.boundsTree = new MeshBVH(g);
      this.pending = idle(step);
    };
    this.pending = idle(step);
  }

  /** Resolve an R3F intersection to a PickInfo (null if it is not ours). */
  resolve(object: Object3D, point: Vector3, faceIndex: number | undefined | null): PickInfo | null {
    const node = object.userData.ctEntry as string | undefined;
    if (!node) return null;
    const entry = this.entries.find((e) => e.node === node);
    if (!entry) return null;
    const mesh = entry.mesh;
    const geometry = mesh.geometry as BufferGeometry;
    let face = faceIndex ?? null;
    tmpLocal.copy(point);
    mesh.worldToLocal(tmpLocal);
    if (object.userData.ctProxy) {
      // Proxy hit: the closest point on the real vessel surface tells us the face (and so the segment).
      face = null;
      if (geometry.boundsTree) {
        const hit = geometry.boundsTree.closestPointToPoint(tmpLocal, hitInfo);
        if (hit) face = hit.faceIndex;
      }
    }
    let segment: SegmentInfo | null = null;
    const segAttr = geometry.getAttribute('_segment');
    if (face !== null && segAttr) {
      const pos = geometry.getAttribute('position');
      const index = geometry.index;
      const ia = index ? index.getX(face * 3) : face * 3;
      const ib = index ? index.getX(face * 3 + 1) : face * 3 + 1;
      const ic = index ? index.getX(face * 3 + 2) : face * 3 + 2;
      tmpTri.a.fromBufferAttribute(pos, ia);
      tmpTri.b.fromBufferAttribute(pos, ib);
      tmpTri.c.fromBufferAttribute(pos, ic);
      tmpTri.getBarycoord(tmpLocal, tmpBary);
      const scct = segmentAtFace(geometry, segAttr, face, [tmpBary.x, tmpBary.y, tmpBary.z]);
      segment = scct > 0 ? this.segments.get(scct) ?? null : null;
    }
    const colour = geometry.getAttribute('color');
    const territory = entry.kind === 'myocardium' && face !== null && colour ? territoryAtFace(geometry, colour, face) : null;
    return {
      structureId: entry.structureId,
      node: entry.node,
      label: entry.label,
      target: entry.target,
      kind: entry.kind,
      segment,
      territory,
      point: [point.x, point.y, point.z],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.cancel();
    for (const p of this.proxies) {
      p.parent?.remove(p);
      p.geometry.dispose();
    }
    this.proxies.length = 0;
  }
}
