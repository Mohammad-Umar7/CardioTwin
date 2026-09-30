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
import { PICKABLE_KINDS } from './classify';
import { ANTERIOR_SUFFIX, isSplitNode, splitSegments } from './cutSplit';
import { GREAT_VESSEL_CLIP, PULMONARY_CLIP, type RigEntry } from './rig';
import { ALONG_FADE } from './tissue';
import type { HeartFrame } from './explode';
import { segmentAtFace, segmentTable, territoryAtFace, veinTable, type SegmentInfo, type VeinInfo } from './segments';
import { axial, heartWall, meanAngle, type AxisFrame, type RvArc } from './territory';

/** Proxy tube radius = max(3 × lumen radius, floor) — LUMEN §10: "3D hit tubes are 3× vessel radius". */
export const PROXY_SCALE = 3;
export const PROXY_MIN_RADIUS = 0.016;
const PROXY_SIDES = 6;

export interface CentrelineLike {
  id?: string;
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

/**
 * For clip-trimmed great vessels, a test that says whether a hit lies where the vessel is faded out (≤ 10 %
 * alpha): the pulmonary trunk along its wall (`_dist_heart`), the pulmonary veins and systemic vessels inside
 * their clip spheres (rig.ts). Null for every other kind.
 */
function fadedTest(entry: RigEntry): ((hit: Intersection) => boolean) | null {
  const kind = entry.kind;
  const geometry = entry.mesh.geometry as BufferGeometry;
  const along = kind === 'pulmonaryArtery' ? geometry.getAttribute('_dist_heart') : null;
  const fade = ALONG_FADE[kind];
  if (along && fade) {
    const limit = fade[0] + 0.7 * (fade[1] - fade[0]);
    return (hit) => {
      const f = hit.face;
      if (!f) return false;
      return (along.getX(f.a) + along.getX(f.b) + along.getX(f.c)) / 3 > limit;
    };
  }
  const clip = kind === 'pulmonaryArtery' || kind === 'pulmonaryVeins' ? PULMONARY_CLIP : kind === 'aorta' || kind === 'systemicVein' ? GREAT_VESSEL_CLIP : null;
  if (!clip) return null;
  const fixedCentre = new Vector3(...clip.centre);
  const rest = new Vector3();
  // The sphere's live uniforms when the material has them (the systemic sphere tightens while a vessel is
  // selected), else the published constants.
  const live = () => {
    const u = (entry.mesh.material as { userData?: { ct?: { uniforms?: Record<string, { value: unknown }> } } }).userData?.ct?.uniforms;
    const centre = u?.uClipCentre?.value as Vector3 | undefined;
    const radius = u?.uClipRadius?.value as number | undefined;
    const feather = u?.uClipFeather?.value as number | undefined;
    return centre && radius !== undefined && feather !== undefined
      ? { centre, limit: radius - 0.3 * feather }
      : { centre: fixedCentre, limit: clip.radius - 0.3 * clip.feather };
  };
  return (hit) => {
    const { centre, limit } = live();
    return entry.mesh.worldToLocal(rest.copy(hit.point)).add(entry.restOffset).distanceTo(centre) > limit;
  };
}
const tmpLocal = new Vector3();
const tmpRest = new Vector3();
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
  private readonly veins: Map<number, VeinInfo>;
  private pending: IdleHandle | null = null;
  private disposed = false;
  /** Long-axis frame and interventricular grooves, for naming the wall under the pointer. */
  private readonly axis: AxisFrame | null;
  private readonly arc: RvArc | null;

  constructor(
    private readonly entries: readonly RigEntry[],
    manifestSegments: unknown,
    vessels: readonly CentrelineLike[] | null,
    manifestVeins: unknown = null,
    frame: HeartFrame | null = null,
  ) {
    this.segments = segmentTable(manifestSegments);
    this.veins = veinTable(manifestVeins);
    this.axis = frame ? { apex: frame.apex, axis: frame.axis, length: frame.length } : null;
    const trunk = (id: string, lo: number, hi: number) => {
      const pts = vessels?.find((v) => v.id === id)?.segments[0]?.points ?? [];
      const a = Math.floor(pts.length * lo);
      return pts.slice(a, Math.max(a + 1, Math.floor(pts.length * hi))).map((q) => new Vector3(q[0], q[1], q[2]));
    };
    const lad = this.axis ? meanAngle(this.axis, trunk('LAD', 0.2, 0.8)) : null;
    const pda = this.axis ? meanAngle(this.axis, trunk('RCA_PDA', 0.2, 0.9)) : null;
    const margin = this.axis ? meanAngle(this.axis, trunk('RCA_MARGINAL', 0.3, 1)) : null;
    this.arc = lad !== null && pda !== null && margin !== null ? { lad, pda, margin } : null;
    for (const entry of entries) {
      if (!PICKABLE_KINDS.has(entry.kind)) continue;
      const mesh = entry.mesh;
      mesh.userData.ctEntry = entry.node;
      const faded = fadedTest(entry);
      mesh.raycast = function raycast(this: Mesh, raycaster: Raycaster, hits: Intersection[]) {
        if (!entry.pickable) return;
        const before = hits.length;
        acceleratedRaycast.call(this, raycaster, hits);
        // A great vessel's trimmed-away stretch (clip sphere / along-the-wall fade) is invisible: it must not
        // answer the pointer in what looks like empty stage.
        if (faded) for (let i = hits.length - 1; i >= before; i -= 1) if (faded(hits[i]!)) hits.splice(i, 1);
      };
    }
    // Proxy tubes: children of their vessel node, so they explode, hinge and beat with it. A vessel split at
    // the cut plane (cutSplit.ts) gets one proxy per part, each on the half it rides.
    const parts: { entry: RigEntry; segments: CentrelineLike['segments'] }[] = [];
    for (const v of vessels ?? []) {
      const entry = entries.find((e) => e.node === v.node);
      if (!entry || (entry.kind !== 'coronary' && entry.kind !== 'leftMain')) continue;
      const sibling = isSplitNode(v.node) ? entries.find((e) => e.node === `${v.node}${ANTERIOR_SUFFIX}`) : undefined;
      if (sibling && frame) {
        const { back, front } = splitSegments(frame, v.segments);
        parts.push({ entry, segments: back as unknown as CentrelineLike['segments'] }, { entry: sibling, segments: front as unknown as CentrelineLike['segments'] });
      } else parts.push({ entry, segments: v.segments });
    }
    for (const { entry, segments } of parts) {
      const geometry = buildProxyGeometry(segments, entry.restOffset);
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
    let vein: VeinInfo | null = null;
    const segAttr = geometry.getAttribute('_segment');
    const veinAttr = geometry.getAttribute('_vein');
    if (face !== null && (segAttr || veinAttr)) {
      const pos = geometry.getAttribute('position');
      const index = geometry.index;
      const ia = index ? index.getX(face * 3) : face * 3;
      const ib = index ? index.getX(face * 3 + 1) : face * 3 + 1;
      const ic = index ? index.getX(face * 3 + 2) : face * 3 + 2;
      tmpTri.a.fromBufferAttribute(pos, ia);
      tmpTri.b.fromBufferAttribute(pos, ib);
      tmpTri.c.fromBufferAttribute(pos, ic);
      tmpTri.getBarycoord(tmpLocal, tmpBary);
      const bary = [tmpBary.x, tmpBary.y, tmpBary.z] as const;
      if (segAttr) {
        const scct = segmentAtFace(geometry, segAttr, face, bary);
        segment = scct > 0 ? this.segments.get(scct) ?? null : null;
      }
      if (veinAttr) {
        const code = segmentAtFace(geometry, veinAttr, face, bary);
        vein = code > 0 ? this.veins.get(code) ?? null : null;
      }
    }
    const colour = geometry.getAttribute('color');
    const territory = entry.kind === 'myocardium' && face !== null && colour ? territoryAtFace(geometry, colour, face) : null;
    // The wall under the pointer, from its REST position (local = rest geometry; + the node's rest offset).
    const wall =
      entry.kind === 'myocardium' && this.axis && this.arc ? heartWall(this.arc, axial(this.axis, tmpRest.copy(tmpLocal).add(entry.restOffset))) : null;
    return {
      structureId: entry.structureId,
      node: entry.node,
      label: entry.label,
      target: entry.target,
      kind: entry.kind,
      segment,
      territory,
      vein,
      wall,
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
