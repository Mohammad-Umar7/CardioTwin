/**
 * Exploded-view maths (pure; unit tested in explode.test.ts).
 *
 * Contract (manifest `explode_semantics`): displayed position = rest position + t · (layer.explode +
 * structure.explode), t ∈ [0, 1], in the parent layer's space. On top of that translation this module adds:
 *
 *  - PEEL WINDOWS: one scalar e ∈ [0, 1] (viewerStore.explode) drives every layer; each layer runs its own
 *    part of e (DESIGN_SYSTEM §6 "Peel"), eased in-out, so the dissection reads outside-in.
 *  - HINGES: the anterior heart half swings open about an axis in the heart's cut plane (the AV groove),
 *    like a lid, before sliding out along the cut-plane normal — valves and papillary muscles are revealed.
 *    Manifest `pivot` / `hingeAxis` / `hingeDeg` win when present; otherwise the hinge is derived from
 *    `manifest.heart` (cut plane + long axis).
 *  - RIDES: a structure with `rides: <wall node>` inherits that wall's full rigid transform (translation AND
 *    hinge), so a coronary branch never detaches from the myocardium it supplies.
 *  - SPRINGS: the displayed e follows the store value through a critically damped spring (no overshoot,
 *    LUMEN §6), so every change — slider scrub, ▶ Dissect, ⟲ Assemble — glides and returns smoothly.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

export type Vec3 = readonly [number, number, number];

/** Peel windows per layer id (DESIGN_SYSTEM §6): the layer's progress runs inside [start, end] of e. */
export const PEEL_WINDOWS: Readonly<Record<string, readonly [number, number]>> = {
  skin: [0, 0.25],
  muscle: [0.05, 0.3],
  skeleton: [0.15, 0.45],
  lungs: [0.3, 0.6],
  diaphragm: [0.45, 0.65],
  heart: [0.7, 1],
  coronary: [0.7, 1],
};

/**
 * An outer layer (skin, muscle, ribs, lungs, diaphragm) is solid only in the first 30 % of its window: it fades
 * to its ghost while it has barely moved, so no opaque piece ever flies past the framed thorax or under a
 * card (and a closing chest turns solid only once it is nearly home).
 */
export const PEEL_SOLID_UNTIL = 0.3;

/** Peel detents (V2 §5.11): Closed · Skin off · Ribs open · Lungs aside ◆ · Open heart. */
export const PEEL_DETENTS = [
  { id: 'closed', label: 'Closed', value: 0 },
  { id: 'skin', label: 'Skin off', value: 0.25 },
  { id: 'ribs', label: 'Ribs open', value: 0.45 },
  { id: 'lungs', label: 'Lungs aside', value: 0.6 },
  { id: 'heart', label: 'Open heart', value: 1 },
] as const;

/** Anterior heart half hinge when the manifest has none: 16° (LUMEN 12–20°) about the AV groove. */
export const DEFAULT_HEART_HINGE_DEG = 16;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Cubic in-out (LUMEN `peel` easing, cubic-bezier(.65,0,.35,1) is visually equivalent). */
export const easePeel = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Progress of a layer at peel scalar e, eased inside its window. */
export function windowProgress(e: number, window: readonly [number, number]): number {
  const [a, b] = window;
  if (b <= a) return e >= b ? 1 : 0;
  return easePeel((e - a) / (b - a));
}

export interface Hinge {
  /** A point on the hinge axis (rest frame). */
  pivot: Vector3;
  /** Unit axis; positive angle follows the right-hand rule. */
  axis: Vector3;
  /** Angle at full progress, degrees. */
  deg: number;
}

export interface ExplodeSpec {
  node: string;
  layerId: string;
  /** layer.explode + structure.explode (scene units, rest frame). */
  vector: Vector3;
  window: readonly [number, number];
  hinge: Hinge | null;
  /** Wall node whose transform this structure inherits, if any. */
  rides: string | null;
}

const tmpQ = new Quaternion();
const tmpR = new Matrix4();
const tmpT = new Matrix4();
const tmpV = new Vector3();

/**
 * Rigid delta (rest frame → displayed frame) of a structure at progress k: first the hinge about its pivot,
 * then the explode translation. `out` is overwritten and returned. Allocation-free (called per frame).
 * `clamp = false` lets the cold-load assembly start a layer further out than its full explode (k > 1).
 */
export function explodeDelta(spec: Pick<ExplodeSpec, 'vector' | 'hinge'>, k: number, out = new Matrix4(), clamp = true): Matrix4 {
  const t = clamp ? clamp01(k) : Math.max(0, k);
  out.makeTranslation(spec.vector.x * t, spec.vector.y * t, spec.vector.z * t);
  if (spec.hinge && spec.hinge.deg !== 0 && t > 0) {
    const { pivot, axis, deg } = spec.hinge;
    const angle = ((deg * Math.PI) / 180) * Math.min(t, 1);
    tmpQ.setFromAxisAngle(axis, angle);
    out.multiply(tmpT.makeTranslation(pivot.x, pivot.y, pivot.z));
    out.multiply(tmpR.makeRotationFromQuaternion(tmpQ));
    out.multiply(tmpT.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  }
  return out;
}

/**
 * Delta of a structure that rides a wall: the wall's own delta at the wall's progress, plus whatever the
 * rider's vector adds on top of the wall's (usually nothing: the manifest gives riders the wall's vector).
 */
export function riderDelta(
  rider: Pick<ExplodeSpec, 'vector'>,
  wall: Pick<ExplodeSpec, 'vector' | 'hinge'>,
  kWall: number,
  kRider: number,
  out = new Matrix4(),
): Matrix4 {
  explodeDelta(wall, kWall, out);
  const extra = tmpV.copy(rider.vector).multiplyScalar(clamp01(kRider));
  extra.x -= wall.vector.x * clamp01(kWall);
  extra.y -= wall.vector.y * clamp01(kWall);
  extra.z -= wall.vector.z * clamp01(kWall);
  if (extra.lengthSq() > 1e-12) out.premultiply(tmpT.makeTranslation(extra.x, extra.y, extra.z));
  return out;
}

// --------------------------------------------------------------------------------- heart frame

export interface HeartFrame {
  apex: Vector3;
  /** Centre of the base (AV plane). */
  base: Vector3;
  /** Unit long axis, apex → base. */
  axis: Vector3;
  /** Apex-to-base length (scene units). */
  length: number;
  /** Cut plane that splits the anterior and posterior halves (for hinge and section). */
  cutPoint: Vector3;
  cutNormal: Vector3;
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n));

/** Fallback frame for a heart without a manifest (procedural placeholder): apex left-inferior-anterior. */
export const FALLBACK_HEART: {
  apex: Vec3;
  base: Vec3;
  cutPoint: Vec3;
  cutNormal: Vec3;
} = {
  apex: [0.47, -0.42, 0.36],
  base: [-0.09, -0.13, 0],
  cutPoint: [0.19, -0.27, 0.18],
  cutNormal: [-0.447, 0.23, 0.865],
};

/** Reads `manifest.heart` (additive, untyped in the contract) with the fallback for missing fields. */
export function heartFrameFrom(heart: unknown): HeartFrame {
  const h = (heart ?? {}) as Record<string, unknown>;
  const cut = (h.cut_plane ?? {}) as Record<string, unknown>;
  const apex = new Vector3(...(isVec3(h.apex) ? h.apex : FALLBACK_HEART.apex));
  const base = new Vector3(...(isVec3(h.base_center) ? h.base_center : FALLBACK_HEART.base));
  const axis = base.clone().sub(apex);
  const length = Math.max(axis.length(), 1e-3);
  axis.divideScalar(length);
  const cutPoint = new Vector3(...(isVec3(cut.point) ? cut.point : FALLBACK_HEART.cutPoint));
  const cutNormal = new Vector3(...(isVec3(cut.normal) ? cut.normal : FALLBACK_HEART.cutNormal)).normalize();
  return { apex, base, axis, length, cutPoint, cutNormal };
}

/**
 * Default hinge for the anterior half: an axis lying in the cut plane, perpendicular to the long axis
 * (i.e. along the AV groove), through the base of the heart. Opening rotates the half's apex toward the
 * viewer (+cut normal) — a lid swinging open from the base — which uncovers the valves and the chambers.
 */
export function defaultHeartHinge(frame: HeartFrame, deg = DEFAULT_HEART_HINGE_DEG): Hinge {
  const n = frame.cutNormal;
  // Long axis projected into the cut plane.
  const inPlaneAxis = frame.axis.clone().addScaledVector(n, -frame.axis.dot(n));
  if (inPlaneAxis.lengthSq() < 1e-8) inPlaneAxis.set(0, 1, 0);
  inPlaneAxis.normalize();
  // Hinge line: in the plane, perpendicular to the (projected) long axis.
  const axis = new Vector3().crossVectors(n, inPlaneAxis).normalize();
  // Pivot: the base centre projected onto the cut plane.
  const pivot = frame.base.clone().addScaledVector(n, -frame.base.clone().sub(frame.cutPoint).dot(n));
  // Sign: positive rotation must move the apex along +n (toward the opening side).
  const apexArm = frame.apex.clone().sub(pivot);
  const moved = apexArm.clone().applyAxisAngle(axis, (deg * Math.PI) / 180);
  const sign = moved.sub(apexArm).dot(n) >= 0 ? 1 : -1;
  return { pivot, axis: axis.multiplyScalar(sign), deg };
}

// ------------------------------------------------------------------------------- manifest specs

export interface ManifestLike {
  layers: readonly {
    id: string;
    node: string;
    explode: readonly number[];
    nodes?: readonly string[];
    pivot?: readonly number[];
    hingeAxis?: readonly number[];
    hingeDeg?: number;
  }[];
  structures: readonly {
    node: string;
    layer: string;
    explode?: readonly number[];
    rides?: string;
    pivot?: unknown;
    hingeAxis?: unknown;
    hingeDeg?: unknown;
  }[];
}

const vec = (v: readonly number[] | undefined | null) => (v && v.length >= 3 ? new Vector3(v[0], v[1], v[2]) : new Vector3());

function manifestHinge(src: { pivot?: unknown; hingeAxis?: unknown; hingeDeg?: unknown }): Hinge | null {
  if (!isVec3(src.pivot) || !isVec3(src.hingeAxis) || typeof src.hingeDeg !== 'number') return null;
  const axis = new Vector3(...src.hingeAxis);
  if (axis.lengthSq() < 1e-8) return null;
  return { pivot: new Vector3(...src.pivot), axis: axis.normalize(), deg: src.hingeDeg };
}

/** Node that gets the default heart hinge (the half that swings open). */
export const OPENING_WALL = 'Heart_Wall_Anterior';

/**
 * Secondary separation of the open heart, so it reads as a real exploded view and not only a lid: the great
 * vessels (roots, ascending aorta, trunks, caval veins) lift off the base along +Y while the anterior half
 * swings open. Added only where the manifest gives the structure no vector of its own.
 */
export const GREAT_VESSEL_LIFT: Vec3 = [0, 0.26, 0];
const LIFTS_OFF_THE_BASE = /^GreatVessel_/;
/**
 * The great vessels lift FIRST (from rest), so ▶ Explode opens with the roots rising off the base before the
 * anterior half swings (the heart's own window starts at 0.7): the separation reads even on a slow GPU.
 */
export const GREAT_VESSEL_WINDOW: readonly [number, number] = [0.6, 0.88];

/**
 * One ExplodeSpec per structure node: vector = layer + structure explode, the layer's peel window, the
 * hinge (manifest first; the anterior heart half gets the derived AV-groove hinge), and the `rides` link.
 * Nodes listed in a layer's `nodes` but missing from `structures` move with the layer vector alone.
 */
export function buildExplodeSpecs(manifest: ManifestLike, frame: HeartFrame | null): Map<string, ExplodeSpec> {
  const specs = new Map<string, ExplodeSpec>();
  const layers = new Map(manifest.layers.map((l) => [l.id, l]));
  for (const s of manifest.structures) {
    const layer = layers.get(s.layer);
    const vector = vec(layer?.explode).add(vec(s.explode));
    if (vector.lengthSq() < 1e-8 && s.layer === 'heart' && LIFTS_OFF_THE_BASE.test(s.node)) vector.set(...GREAT_VESSEL_LIFT);
    let hinge = manifestHinge(s) ?? (layer ? manifestHinge(layer) : null);
    if (!hinge && s.node === OPENING_WALL && frame) hinge = defaultHeartHinge(frame);
    const lifts = s.layer === 'heart' && LIFTS_OFF_THE_BASE.test(s.node);
    specs.set(s.node, {
      node: s.node,
      layerId: s.layer,
      vector,
      window: lifts ? GREAT_VESSEL_WINDOW : (PEEL_WINDOWS[s.layer] ?? [0, 1]),
      hinge,
      rides: s.rides && s.rides !== s.node ? s.rides : null,
    });
  }
  for (const layer of manifest.layers) {
    for (const node of layer.nodes ?? []) {
      if (specs.has(node)) continue;
      specs.set(node, {
        node,
        layerId: layer.id,
        vector: vec(layer.explode),
        window: PEEL_WINDOWS[layer.id] ?? [0, 1],
        hinge: manifestHinge(layer),
        rides: null,
      });
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------------------- spring

/**
 * One step of a critically damped spring toward `target` (exact solution, stable for any dt). Critically
 * damped means it never overshoots (LUMEN §6: no bounce). ω sets the speed: ≈ 4.7/ω seconds to settle
 * within 1 %. Returns the new [position, velocity].
 */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  if (dt <= 0) return [x, v];
  const d = x - target;
  const e = Math.exp(-omega * dt);
  const c = v + omega * d;
  const nx = target + (d + c * dt) * e;
  const nv = (v - omega * c * dt) * e;
  return [nx, nv];
}

/** Settle time (seconds) of the peel spring: ω = 7 settles the full 0 → 1 travel in ≈ 0.7 s. */
export const PEEL_SPRING_OMEGA = 7;
