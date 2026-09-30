/**
 * Procedural placeholder heart, used until (or if) the BodyParts3D GLB is unavailable.
 *
 * Scene conventions follow CONTRACTS §6.1: 1 unit = 10 cm, +X = patient's left, +Y = superior,
 * +Z = anterior, origin = centre of the heart-wall bounding box. The shape is an analytic deformation of
 * a sphere (conical towards an apex that points left, inferior and anterior), so vessel paths can be
 * written as (t, φ) coordinates on the surface and land exactly on it:
 *   t ∈ [-1, 1] runs from the base (−1) to the apex (+1) along the long axis,
 *   φ is the angle around the long axis: 0° anterior, +90° right (acute margin), −90° left (obtuse
 *   margin), ±180° posterior.
 * This is an illustrative schematic, not anatomy; it carries the same node names as the GLB.
 */
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, SphereGeometry, Vector3 } from 'three';
import type { TargetId } from '@/types/contracts';

/** Long axis, base → apex (left, inferior, anterior). */
export const APEX_AXIS = new Vector3(0.55, -0.72, 0.42).normalize();
const ANTERIOR_REF = new Vector3(0, 0, 1).addScaledVector(APEX_AXIS, -APEX_AXIS.z).normalize();
const RIGHT_REF = new Vector3().crossVectors(APEX_AXIS, ANTERIOR_REF).normalize();

const RADIUS = 0.56;
const RV_DIR = new Vector3(-0.62, -0.05, 0.78).normalize();

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Surface point (before centring) for a unit direction. */
function rawSurface(dir: Vector3, out: Vector3): Vector3 {
  const t = dir.dot(APEX_AXIS);
  const perp = new Vector3().copy(dir).addScaledVector(APEX_AXIS, -t);
  const taper = 1 - 0.5 * smoothstep(0.05, 1.0, t);
  const along = t > 0 ? t * 1.38 : t * 0.9;
  const rv = 0.075 * Math.pow(Math.max(0, dir.dot(RV_DIR)), 2);
  const baseFlat = 1 - 0.12 * smoothstep(-0.55, -1, t);
  out.copy(APEX_AXIS).multiplyScalar(along * RADIUS * baseFlat);
  out.addScaledVector(perp, taper * RADIUS * (1 + rv));
  return out;
}

/** Offset that puts the heart-wall bounding-box centre at the origin. */
export const HEART_CENTRE: Vector3 = (() => {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const d = new Vector3();
  const p = new Vector3();
  for (let i = 0; i < 64; i += 1) {
    for (let j = 0; j < 32; j += 1) {
      const theta = (i / 64) * Math.PI * 2;
      const phi = (j / 31) * Math.PI;
      d.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      rawSurface(d, p);
      min.min(p);
      max.max(p);
    }
  }
  return min.add(max).multiplyScalar(0.5);
})();

export function surfacePoint(dir: Vector3, out = new Vector3()): Vector3 {
  return rawSurface(dir, out).sub(HEART_CENTRE);
}

/** Unit direction for surface coordinates (t along the long axis, φ in degrees around it). */
export function directionAt(t: number, phiDeg: number, out = new Vector3()): Vector3 {
  const phi = (phiDeg * Math.PI) / 180;
  const r = Math.sqrt(Math.max(0, 1 - t * t));
  return out
    .copy(APEX_AXIS)
    .multiplyScalar(t)
    .addScaledVector(ANTERIOR_REF, r * Math.cos(phi))
    .addScaledVector(RIGHT_REF, r * Math.sin(phi))
    .normalize();
}

export function buildHeartGeometry(widthSegments = 128, heightSegments = 96): BufferGeometry {
  const geo = new SphereGeometry(1, widthSegments, heightSegments);
  const pos = geo.attributes.position as BufferAttribute;
  const d = new Vector3();
  const p = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    d.fromBufferAttribute(pos, i).normalize();
    surfacePoint(d, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------------------------ vessels

export interface ProceduralVessel {
  /** GLB node name it stands in for. */
  node: string;
  /** Target that colours it; null = not predicted (left main). */
  target: TargetId | null;
  /** Surface path as (t, φ°) pairs, proximal → distal. */
  path: readonly (readonly [number, number])[];
  radius: [number, number];
  /** Main trunk of its target (carries the label anchor). */
  main?: boolean;
}

export const PROCEDURAL_VESSELS: readonly ProceduralVessel[] = [
  { node: 'Coronary_LM', target: null, path: [[-0.7, -8], [-0.62, -24], [-0.55, -36]], radius: [0.03, 0.028] },
  {
    node: 'Coronary_LAD',
    target: 'LAD',
    main: true,
    path: [[-0.55, -36], [-0.38, -16], [-0.1, -6], [0.3, -4], [0.62, -7], [0.86, -14], [0.97, -40]],
    radius: [0.026, 0.012],
  },
  { node: 'Coronary_LAD_Diagonal', target: 'LAD', path: [[-0.2, -9], [0.08, -30], [0.36, -48], [0.55, -56]], radius: [0.017, 0.009] },
  {
    node: 'Coronary_LCX',
    target: 'LCX',
    main: true,
    path: [[-0.55, -36], [-0.52, -62], [-0.47, -92], [-0.43, -122], [-0.38, -148]],
    radius: [0.024, 0.013],
  },
  { node: 'Coronary_LCX_Marginal', target: 'LCX', path: [[-0.47, -95], [-0.12, -104], [0.22, -102], [0.45, -96]], radius: [0.016, 0.009] },
  {
    node: 'Coronary_RCA',
    target: 'RCA',
    main: true,
    path: [[-0.72, 30], [-0.6, 52], [-0.5, 84], [-0.44, 118], [-0.4, 150], [-0.37, 176]],
    radius: [0.027, 0.018],
  },
  { node: 'Coronary_RCA_Marginal', target: 'RCA', path: [[-0.48, 96], [-0.12, 98], [0.2, 94], [0.4, 88]], radius: [0.016, 0.009] },
  { node: 'Coronary_RCA_PDA', target: 'RCA', path: [[-0.37, 176], [-0.05, 176], [0.35, 172], [0.7, 164]], radius: [0.018, 0.01] },
];

/** Dense centreline for a vessel, lifted slightly off the wall so the tube sits on the surface. */
export function vesselCurve(v: ProceduralVessel, lift = 0.012): CatmullRomCurve3 {
  const pts: Vector3[] = [];
  const d = new Vector3();
  for (let i = 0; i < v.path.length - 1; i += 1) {
    const [t0, p0] = v.path[i]!;
    const [t1, p1] = v.path[i + 1]!;
    const steps = 8;
    for (let s = 0; s < steps; s += 1) {
      const u = s / steps;
      directionAt(t0 + (t1 - t0) * u, p0 + (p1 - p0) * u, d);
      const p = surfacePoint(d);
      const n = p.clone().add(HEART_CENTRE).normalize();
      pts.push(p.addScaledVector(n, lift));
    }
  }
  const [tl, pl] = v.path[v.path.length - 1]!;
  directionAt(tl, pl, d);
  const last = surfacePoint(d);
  pts.push(last.addScaledVector(last.clone().add(HEART_CENTRE).normalize(), lift));
  return new CatmullRomCurve3(pts, false, 'centripetal');
}

/**
 * Tube with a radius that tapers from r0 (proximal) to r1 (distal), capped at both ends. Built from the
 * curve's Frenet frames like THREE.TubeGeometry. Adds `_ARCLEN` (0 → 1 along the tube) so phase-2
 * shaders (draw-in, ripple, tier-C flow dashes) work the same on procedural and GLB vessels.
 */
export function buildTaperedTube(
  curve: CatmullRomCurve3,
  r0: number,
  r1: number,
  tubularSegments = 96,
  radialSegments = 12,
): BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const arclen: number[] = [];
  const indices: number[] = [];
  const p = new Vector3();
  const n = new Vector3();

  for (let i = 0; i <= tubularSegments; i += 1) {
    const u = i / tubularSegments;
    curve.getPointAt(u, p);
    const r = r0 + (r1 - r0) * u;
    const N = frames.normals[i]!;
    const B = frames.binormals[i]!;
    for (let j = 0; j <= radialSegments; j += 1) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      n.set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();
      normals.push(n.x, n.y, n.z);
      positions.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
      arclen.push(u);
    }
  }
  for (let i = 1; i <= tubularSegments; i += 1) {
    for (let j = 1; j <= radialSegments; j += 1) {
      const a = (radialSegments + 1) * (i - 1) + (j - 1);
      const b = (radialSegments + 1) * i + (j - 1);
      const c = (radialSegments + 1) * i + j;
      const d = (radialSegments + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  // end caps (flat discs)
  const cap = (atStart: boolean) => {
    const u = atStart ? 0 : 1;
    const centre = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).multiplyScalar(atStart ? -1 : 1);
    const centreIndex = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    normals.push(tangent.x, tangent.y, tangent.z);
    arclen.push(u);
    const ring = atStart ? 0 : tubularSegments * (radialSegments + 1);
    for (let j = 0; j < radialSegments; j += 1) {
      const a = ring + j;
      const b = ring + j + 1;
      if (atStart) indices.push(centreIndex, b, a);
      else indices.push(centreIndex, a, b);
    }
  };
  cap(true);
  cap(false);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('_ARCLEN', new BufferAttribute(new Float32Array(arclen), 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------------------- territories

/**
 * Per-vertex supplied-territory weights (R = LAD, G = LCX, B = RCA) from proximity to each target's
 * vessels — the same documented approximation the anatomy pipeline bakes into COLOR_0. Not a lesion map.
 */
export function territoryWeights(heart: BufferGeometry, curves: { target: TargetId | null; curve: CatmullRomCurve3 }[]): Float32Array {
  const pos = heart.attributes.position as BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const channels: Record<string, number> = { LAD: 0, LCX: 1, RCA: 2 };
  const samples = curves
    .filter((c) => c.target && c.target in channels)
    .map((c) => ({ ch: channels[c.target as string]!, pts: c.curve.getSpacedPoints(48) }));
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const best = [Infinity, Infinity, Infinity];
    for (const s of samples) {
      for (const p of s.pts) {
        const d2 = v.distanceToSquared(p);
        if (d2 < best[s.ch]!) best[s.ch] = d2;
      }
    }
    // inverse-distance weights with a soft falloff (~0.25 units)
    const w = best.map((d2) => 1 / (1 + d2 / 0.02));
    out[i * 3] = w[0]!;
    out[i * 3 + 1] = w[1]!;
    out[i * 3 + 2] = w[2]!;
  }
  return out;
}

/** Label anchor + outward normal at a fraction along a vessel. */
export function anchorOn(curve: CatmullRomCurve3, u = 0.5): { anchor: Vector3; normal: Vector3 } {
  const anchor = curve.getPointAt(u);
  const normal = anchor.clone().add(HEART_CENTRE).normalize();
  return { anchor, normal };
}
