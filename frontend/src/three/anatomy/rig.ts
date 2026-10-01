/**
 * The anatomy rig: owns every GLB mesh's materials, transforms and visibility, per frame, without React
 * state. GlbAnatomy builds one per loaded scene and calls `update()` from useFrame.
 *
 * Per mesh the displayed matrix is   M = E · A · R
 *   R  rest local matrix (each GLB node is centred on itself; R carries its rest offset)
 *   A  cold-load assembly fly-in (explode direction, anterior half re-closing its hinge)
 *   E  peel / exploded view: layer + structure vectors, the anterior half's hinge, riders follow their wall
 * so a coronary that rides a wall shares E and A with it and can never detach. The heartbeat is not in the
 * matrix: ONE displacement field in the rest frame, in every heart and great-vessel vertex shader
 * (beatDeform.ts), so meshes that touch at rest touch through the whole beat. Every mesh also gets a ghost twin
 * (same geometry, additive fresnel) so solid ↔ ghost transitions crossfade instead of popping.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  Plane,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import type { Stage } from '@/state/viewerStore';
import type { AnatomyManifest, TargetId } from '@/types/contracts';
import { getRiskLUT } from '../riskLut';
import type { SceneLook } from '../stage/sceneControls';
import { sceneRuntime } from '../stage/sceneRuntime';
import { AssemblyClock, stageById, stagePose, type AssemblyStage } from './assembly';
import { ANTERIOR_SUFFIX, SPLIT_AT_CUT, SPLIT_BY_PIECE } from './cutSplit';
import { heightOf, setBeatActivation, setBeatFrame } from './beatDeform';
import { PointHash, graphComponents, vesselBeatWeights, weldGraph } from './beatWeights';
import { straightCutDistance } from './vesselCuts';
import { deflateDirections } from './fatDeflate';
import { cavityAttribute, type CentrelinePoint } from './cavity';
import { axial, correctWeights, meanAngle, rvShare } from './territory';
import { FRAME_UNIFORMS } from './shaders';
import {
  BEATS_WITH_HEART,
  CLIPPED_TREE_KINDS,
  GREAT_VESSEL_KINDS,
  OUTER_KINDS,
  PICKABLE_KINDS,
  assemblyStageOf,
  beatModeOf,
  classifyNode,
  type TissueKind,
} from './classify';
import {
  OPENING_WALL,
  PEEL_SPRING_OMEGA,
  buildExplodeSpecs,
  explodeDelta,
  heartFrameFrom,
  peeledAt,
  riderDelta,
  springStep,
  windowProgress,
  type ExplodeSpec,
  type HeartFrame,
  type ManifestLike,
} from './explode';
import {
  ALONG_FADE,
  ALONG_KEEPS_SPHERE,
  VESSEL_INFLATE,
  createGhostMaterial,
  createSharedUniforms,
  createTissueMaterial,
  setGhostLook,
  type BakedMaps,
  type GhostMaterial,
  type QualityTier,
  type SharedUniforms,
  type TissueMaterial,
} from './tissue';

export interface RigEntry {
  mesh: Mesh;
  ghostMesh: Mesh;
  node: string;
  kind: TissueKind;
  layerId: string;
  target: TargetId | null;
  structureId: string;
  label: string;
  restMatrix: Matrix4;
  restOffset: Vector3;
  spec: ExplodeSpec | null;
  wall: ExplodeSpec | null;
  /** Assembly stage and its fly-in transform (vector + hinge). */
  stage: AssemblyStage;
  flyIn: Pick<ExplodeSpec, 'vector' | 'hinge'>;
  /** Entry whose assembly transform a rider copies (its wall). */
  flyInFrom: RigEntry | null;
  maps: BakedMaps | null;
  mapsReady: boolean;
  solid: Map<string, TissueMaterial>;
  ghost: GhostMaterial;
  solidAmt: number;
  ghostAmt: number;
  /** Assembly pose this frame (A matrix + reveal), shared with riders. */
  assemblyMatrix: Matrix4;
  assemblyReveal: number;
  /** E this frame (without beat), for label anchors. */
  explodeMatrix: Matrix4;
  pickable: boolean;
}

export interface RigInputs {
  dt: number;
  explodeTarget: number;
  look: SceneLook;
  stage: Stage;
  layerVisibility: Readonly<Record<string, boolean>>;
  ghostLayers: boolean;
  selected: TargetId | null;
  /**
   * Trim the great vessels to their roots (a selection or a projection view): from lateral and posterior
   * angles the arch and the descending aorta would stand in front of the heart.
   */
  trimGreatVessels?: boolean;
  isolate: boolean;
  ghostOthers: boolean;
  showVeins: boolean;
  section: boolean;
  sectionDepth: number;
  reduced: boolean;
  /** Ventricular / atrial activation (already enveloped). */
  beatV: number;
  beatA: number;
}

export interface RigOptions {
  manifest: AnatomyManifest | null;
  nodeTargets: ReadonlyMap<string, TargetId>;
  look: SceneLook;
  tier: QualityTier;
  /** Play the cold-load assembly (false = start assembled). */
  assemble: boolean;
}

const LAMBDA_FADE = 11;
/** A frame gap longer than this during the assembly means the page was not on screen: finish it. */
const ASSEMBLY_GAP_S = 0.5;
/** First frames of the assembly (program compilation, first texture uploads) never count as slow. */
const ASSEMBLY_WARMUP_FRAMES = 6;
const LAMBDA_SECTION = 6;
/** Section plane parked far away (nothing clipped) — the plane stays attached so no program recompiles. */
const SECTION_OFF = 3;
/** A great-vessel vertex this close to the heart wall (fraction of the apex-to-base length) seeds its junction. */
const BEAT_WEIGHT_TOUCH = 0.02;
/**
 * The descending limb (more than 40 mm behind the AV-plane centre; the ascending aorta lies within 29 mm of it) is
 * cut below a plane 95 mm above that centre (all of it inside the great-vessel sphere), and the whole aorta below
 * the AV plane (`floor`: the root starts above it).
 */
const DESCENDING_AORTA = { behind: 0.4, cutAbove: 0.95, floor: 0 } as const;
/** Specimen cuts (vesselCuts.ts): a vessel's root is where `_dist_heart` < 1.5 mm; 10 mm geodesic margin. */
/** Within 2 mm of the cut the fat's pull-in keeps to the plane, so its cut faces stay flat (fatDeflate.ts). */
const FAT_SEAM_BAND = 0.02;

const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const VESSEL_CUT_ROOT = 0.015;
const VESSEL_CUT_MARGIN = 0.1;
/**
 * How far along each great vessel the heartbeat reaches (fractions of the apex-to-base length L ≈ 72 mm): full
 * weight up to `full`, still from `fade`. The aorta beats fully over its root and sinuses (the coronary ostia sit
 * 13–16 mm above the annulus) and is still by the arch; the trunk likewise to its bifurcation; the veins stretch
 * over their last few centimetres into the atria. Arteries seed only at their root (`maxSeedHeight`).
 */
const VESSEL_BEAT_WEIGHTS: Partial<Record<TissueKind, { full: number; fade: number; maxSeedHeight?: number }>> = {
  aorta: { full: 0.35, fade: 0.9, maxSeedHeight: 1.25 },
  pulmonaryArtery: { full: 0.25, fade: 0.7, maxSeedHeight: 1.35 },
  pulmonaryVeins: { full: 0.06, fade: 0.4 },
  systemicVein: { full: 0.06, fade: 0.4 },
};
/**
 * Pulmonary trees (V2 §5.15): keep the trunk, the proximal left / right pulmonary arteries and the veins
 * entering the left atrium; the intrapulmonary branches fade into the dark stage before the hila. The
 * centre sits between the pulmonary valve and the venous inflow (manifest frame: origin = heart centre).
 */
export const PULMONARY_CLIP = { centre: [0, 0.22, -0.15] as const, radius: 0.56, feather: 0.2 } as const;
/**
 * Systemic great vessels (V2 §5.15 "clean silhouette"): a sphere a little above the heart centre keeps the
 * aortic root, the ascending aorta and the SVC, like an anatomical specimen; the arch, its branches, the
 * brachiocephalic veins, the descending aorta and the IVC fade out with real alpha inside the frame, so the
 * heart can fill 62 % of the free area without the stage edge cutting a vessel.
 */
export const GREAT_VESSEL_CLIP = { centre: [0, 0.05, -0.05] as const, radius: 0.8, feather: 0.24 } as const;
/**
 * While a vessel is selected (or a projection is shown) the systemic sphere moves anterior and shrinks: the
 * ascending aorta, its root and the SVC stay, the arch and the descending aorta fade — from a lateral or
 * posterior view (the LCX's) the descending aorta would otherwise run as a full-height column in front of the
 * lateral wall and the marginals.
 */
export const GREAT_VESSEL_CLIP_SELECTED = { centre: [0, 0.15, 0.22] as const, radius: 0.62, feather: 0.2 } as const;
/**
 * Outer ghosts in the workstation stay faint (V2 §5.15: α ≤ 0.12, "clean silhouette"): bone and cartilage
 * sit right behind and around the heart, so they are the faintest (≤ 2 % over the stage); skin, muscle and
 * the diaphragm keep a trace of the thorax at the frame's edges.
 */
const workstationGhost = (kind: TissueKind) => (kind === 'bone' || kind === 'cartilage' ? 0.15 : 0.3);
/** Workstation skin ghost at Closed: the torso's contour must read ("Skin" is on in Layers). */
const SKIN_GHOST = 0.85;
/** Landing hero lung ghost strength: a trace of context, never a smear behind the copy or the cards. */
const HERO_LUNG_GHOST = 0.4;
/** Peel value from which the chest counts as set aside (the camera's thorax framing ends just below it). */
const PEEL_CHEST_AWAY = 0.58;

const damp = (from: number, to: number, lambda: number, dt: number) => to + (from - to) * Math.exp(-lambda * dt);

function defaultFlyIn(kind: TissueKind, restOffset: Vector3): Vector3 {
  switch (kind) {
    case 'aorta':
    case 'pulmonaryArtery':
    case 'pulmonaryVeins':
    case 'systemicVein':
      return new Vector3(0, 1.15, 0.15);
    case 'myocardium':
    case 'valve':
    case 'papillary':
    case 'cardiacVein':
    case 'fat':
      return new Vector3(0.05, -0.25, -1.1);
    default: {
      const d = restOffset.lengthSq() > 1e-6 ? restOffset.clone().normalize() : new Vector3(0, 0, 1);
      return d.multiplyScalar(1.2);
    }
  }
}

/** Great vessels: their decimated tubes carry split normals along the UV seams (visible facets and seams). */
const SMOOTH_KINDS: ReadonlySet<TissueKind> = new Set(['aorta', 'pulmonaryArtery', 'pulmonaryVeins', 'systemicVein']);

/**
 * The septal perforators run inside the septum: drawn true to size and depth, not inflated nor pulled toward the
 * camera like the epicardial arteries under their fat (pulled, they showed through the septum's cut face as loose
 * purple threads when the heart opened).
 */
const INTRAMURAL: ReadonlySet<string> = new Set(['Coronary_LAD_Septal', 'Coronary_RCA_Septal']);

/**
 * Average the normals of coincident vertices (UV-seam duplicates) whose normals are within 60° of each
 * other, so a tube shades smoothly across its seams while real creases (a cut end) stay sharp. In place and
 * idempotent (marked on the geometry, which the GLB cache shares between mounts).
 */
export function smoothNormals(g: BufferGeometry): void {
  if (g.userData.ctSmoothed) return;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  if (!pos || !nor) return;
  g.userData.ctSmoothed = true;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i += 1) {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const n = new Vector3();
  const m = new Vector3();
  const sum = new Vector3();
  const out = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i += 1) {
    n.fromBufferAttribute(nor, i);
    out[i * 3] = n.x;
    out[i * 3 + 1] = n.y;
    out[i * 3 + 2] = n.z;
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const i of list) {
      n.fromBufferAttribute(nor, i);
      sum.set(0, 0, 0);
      for (const j of list) if (m.fromBufferAttribute(nor, j).dot(n) > 0.5) sum.add(m);
      if (sum.lengthSq() < 1e-12) continue;
      sum.normalize();
      out[i * 3] = sum.x;
      out[i * 3 + 1] = sum.y;
      out[i * 3 + 2] = sum.z;
    }
  }
  // setXYZ: the GLB's normals are quantised and interleaved (meshopt), so never write the raw array.
  for (let i = 0; i < nor.count; i += 1) nor.setXYZ(i, out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!);
  const target = (nor as { data?: { needsUpdate: boolean } }).data ?? nor;
  target.needsUpdate = true;
}

/** Upload order of the baked maps (kinds not listed follow). */
const TEXTURE_ORDER: readonly TissueKind[] = ['myocardium', 'fat', 'cardiacVein', 'aorta', 'pulmonaryArtery', 'pulmonaryVeins', 'systemicVein'];

/** The wall the posterior part of a split node stays on. */
const POSTERIOR_WALL = 'Heart_Wall_Posterior';

/**
 * Split `node` (one mesh) at the heart's cut plane: triangles whose centroid lies on the opening side (+cut
 * normal) move to a sibling mesh `<node>_Anterior` that shares the vertex buffers (and so the `_VEIN` /
 * `_SEGMENT` codes, `_ARCLEN` and the baked maps) and rides the anterior wall with its explode vector; the
 * rest rides the posterior wall, whatever the manifest's `rides` says for the whole node (anatomy 1.1.0 puts
 * the LAD on the posterior half and the RCA on the anterior one). Idempotent (a rebuilt rig on the same scene
 * finds the sibling already there).
 */
/** Pieces of the opening wall that hang from the posterior half (adoptWallTips). */
export const POSTERIOR_TIPS = 'Heart_Wall_Posterior_Tips';

/**
 * The plane cut that opens the heart leaves the anterior wall with a few pieces attached only to the POSTERIOR
 * half (a 22 mm piece of the right atrium's roof that crossed the plane). Riding the anterior half, they flew away
 * from the atrium as the heart opened. At load they move to a sibling mesh that rides the posterior half; pieces
 * that touch the anterior wall's main body stay.
 */
function adoptWallTips(root: Object3D, rootInverse: Matrix4, specs: Map<string, ExplodeSpec>): void {
  let front: Mesh | null = null;
  let back: Mesh | null = null;
  let done = false;
  root.traverse((o) => {
    if (o.name === POSTERIOR_TIPS) done = true;
    if (!(o instanceof Mesh) || o.userData.ctGhost) return;
    if (o.name === OPENING_WALL || (!o.name && o.parent?.name === OPENING_WALL)) front ??= o;
    if (o.name === POSTERIOR_WALL || (!o.name && o.parent?.name === POSTERIOR_WALL)) back ??= o;
  });
  const frontSpec = specs.get(OPENING_WALL);
  const backSpec = specs.get(POSTERIOR_WALL);
  const setSpec = () => {
    if (frontSpec && backSpec && !specs.has(POSTERIOR_TIPS))
      specs.set(POSTERIOR_TIPS, { ...frontSpec, node: POSTERIOR_TIPS, vector: backSpec.vector.clone(), rides: POSTERIOR_WALL, hinge: null });
  };
  if (done) return setSpec();
  const f = front as Mesh | null;
  const b = back as Mesh | null;
  if (!f || !b) return;
  const restOf = (m: Mesh) => {
    const pos = (m.geometry as BufferGeometry).getAttribute('position');
    const toRest = rootInverse.clone().multiply(m.matrixWorld);
    const out = new Float32Array(pos.count * 3);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i += 1) v.fromBufferAttribute(pos, i).applyMatrix4(toRest).toArray(out, i * 3);
    return out;
  };
  const g = f.geometry as BufferGeometry;
  const index = g.index;
  if (!index) return;
  const xyz = restOf(f);
  const { nodeOf, adj } = weldGraph(xyz, index.array, 1e-6);
  const comp = graphComponents(adj);
  const faces = new Map<number, number>();
  for (let t = 0; t < index.count; t += 3) {
    const k = comp[nodeOf[index.getX(t)]!]!;
    faces.set(k, (faces.get(k) ?? 0) + 1);
  }
  let main = -1;
  for (const [k, n] of faces) if (main < 0 || n > faces.get(main)!) main = k;
  const TOUCH = 0.002; // 0.2 mm
  const backHash = new PointHash(TOUCH * 2);
  backHash.add(restOf(b));
  const mainHash = new PointHash(TOUCH * 2);
  const mainPts: number[] = [];
  for (let i = 0; i < nodeOf.length; i += 1) if (comp[nodeOf[i]!] === main) mainPts.push(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!);
  mainHash.add(mainPts);
  const adopt = new Set<number>();
  const checked = new Map<number, [boolean, boolean]>();
  for (let i = 0; i < nodeOf.length; i += 1) {
    const k = comp[nodeOf[i]!]!;
    if (k === main) continue;
    const c = checked.get(k) ?? [false, false];
    c[0] ||= backHash.near(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!, TOUCH);
    c[1] ||= mainHash.near(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!, TOUCH * 1.5);
    checked.set(k, c);
  }
  for (const [k, [touchesBack, touchesMain]] of checked) if (touchesBack && !touchesMain) adopt.add(k);
  if (adopt.size === 0) return;
  const keep: number[] = [];
  const tips: number[] = [];
  for (let t = 0; t + 2 < index.count; t += 3) {
    const a = index.getX(t);
    (adopt.has(comp[nodeOf[a]!]!) ? tips : keep).push(a, index.getX(t + 1), index.getX(t + 2));
  }
  const part = (indices: number[]) => {
    const out = new BufferGeometry();
    for (const [key, attr] of Object.entries(g.attributes)) out.setAttribute(key, attr);
    out.setIndex(indices);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  };
  f.geometry = part(keep);
  const mesh = new Mesh(part(tips), f.material);
  mesh.name = POSTERIOR_TIPS;
  // It answers to the posterior wall (label, picking, territory target); its UVs stay in the anterior wall's atlas.
  mesh.userData.ctSplitFrom = POSTERIOR_WALL;
  mesh.matrix.copy(f.matrix);
  mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.frustumCulled = f.frustumCulled;
  f.parent?.add(mesh);
  mesh.updateMatrixWorld(true);
  setSpec();
}

function splitAtCutPlane(
  root: Object3D,
  rootInverse: Matrix4,
  node: string,
  frame: HeartFrame,
  specs: Map<string, ExplodeSpec>,
  /** Keep every connected piece whole, on the side of its centroid (SPLIT_BY_PIECE). */
  byPiece = false,
): void {
  const name = `${node}${ANTERIOR_SUFFIX}`;
  let found: Mesh | null = null;
  let done = false;
  root.traverse((o) => {
    if (o.name === name) done = true;
    if (!found && o instanceof Mesh && !o.userData.ctGhost && (o.name === node || (!o.name && o.parent?.name === node))) found = o;
  });
  const source = found as Mesh | null;
  const setSpecs = () => {
    const base = specs.get(node);
    const frontWall = specs.get(OPENING_WALL);
    const backWall = specs.get(POSTERIOR_WALL);
    if (!base || !frontWall || !backWall || specs.has(name)) return;
    specs.set(name, { ...base, node: name, vector: frontWall.vector.clone(), rides: OPENING_WALL, hinge: null });
    specs.set(node, { ...base, vector: backWall.vector.clone(), rides: POSTERIOR_WALL, hinge: null });
  };
  if (done) setSpecs();
  if (done || !source) return;
  const g = source.geometry as BufferGeometry;
  const pos = g.getAttribute('position');
  if (!pos) return;
  const toRest = rootInverse.clone().multiply(source.matrixWorld);
  const index = g.index;
  const count = index ? index.count : pos.count;
  const at = (i: number) => (index ? index.getX(i) : i);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const front: number[] = [];
  const back: number[] = [];
  const n = frame.cutNormal;
  const d0 = n.dot(frame.cutPoint);
  // Whole pieces: the side of each connected piece's centroid (welded graph, beatWeights.ts).
  let pieceFront: ((vertex: number) => boolean) | null = null;
  if (byPiece) {
    const xyz = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) a.fromBufferAttribute(pos, i).applyMatrix4(toRest).toArray(xyz, i * 3);
    const { nodeOf, adj } = weldGraph(xyz, index ? index.array : null, 1e-6);
    const comp = graphComponents(adj);
    const sum = new Map<number, [number, number]>();
    for (let i = 0; i < pos.count; i += 1) {
      const k = comp[nodeOf[i]!]!;
      const s = sum.get(k) ?? [0, 0];
      s[0] += n.x * xyz[i * 3]! + n.y * xyz[i * 3 + 1]! + n.z * xyz[i * 3 + 2]! - d0;
      s[1] += 1;
      sum.set(k, s);
    }
    pieceFront = (v) => {
      const s = sum.get(comp[nodeOf[v]!]!)!;
      return s[0] / s[1] > 0;
    };
  }
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = at(i);
    const ib = at(i + 1);
    const ic = at(i + 2);
    if (pieceFront) {
      (pieceFront(ia) ? front : back).push(ia, ib, ic);
      continue;
    }
    a.fromBufferAttribute(pos, ia).applyMatrix4(toRest);
    b.fromBufferAttribute(pos, ib).applyMatrix4(toRest);
    c.fromBufferAttribute(pos, ic).applyMatrix4(toRest);
    const side = (n.dot(a) + n.dot(b) + n.dot(c)) / 3 - d0;
    (side > 0 ? front : back).push(ia, ib, ic);
  }
  if (front.length === 0 || back.length === 0) return;
  const part = (indices: number[]) => {
    const out = new BufferGeometry();
    for (const [key, attr] of Object.entries(g.attributes)) out.setAttribute(key, attr);
    out.setIndex(indices);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  };
  source.geometry = part(back);
  const anterior = new Mesh(part(front), source.material);
  anterior.name = name;
  anterior.userData.ctSplitFrom = node;
  anterior.matrix.copy(source.matrix);
  anterior.matrix.decompose(anterior.position, anterior.quaternion, anterior.scale);
  anterior.frustumCulled = source.frustumCulled;
  source.parent?.add(anterior);
  anterior.updateMatrixWorld(true);
  setSpecs();
}

const texturesOf = (e: RigEntry): Texture[] =>
  [e.maps?.map, e.maps?.normalMap, e.maps?.roughnessMap, e.maps?.aoMap].filter((t, i, all): t is Texture => !!t && all.indexOf(t) === i);

/** Baked PBR maps of the original glTF material (CONTRACTS §7.1), if the GLB carries any. */
function bakedMaps(material: Material | Material[]): BakedMaps | null {
  const m = (Array.isArray(material) ? material[0] : material) as Partial<MeshStandardMaterial> | undefined;
  if (!m) return null;
  const maps: BakedMaps = { map: m.map ?? null, normalMap: m.normalMap ?? null, roughnessMap: m.roughnessMap ?? null, aoMap: m.aoMap ?? null };
  return maps.map || maps.normalMap || maps.roughnessMap || maps.aoMap ? maps : null;
}

export class AnatomyRig {
  readonly entries: RigEntry[] = [];
  readonly byNode = new Map<string, RigEntry>();
  readonly frame: HeartFrame;
  readonly shared: SharedUniforms;
  readonly sectionPlanes: Plane[] = [new Plane(new Vector3(0, 0, 1), 1000)];
  readonly assembly: AssemblyClock;
  private e: number;
  private ev = 0;
  private sectionS = SECTION_OFF;
  private assemblyTicks = 0;
  private frameEma = 1 / 60;
  private look: SceneLook;
  private tier: QualityTier;
  private disposed = false;

  constructor(
    readonly root: Object3D,
    options: RigOptions,
    initialExplode: number,
  ) {
    const manifest = options.manifest;
    this.look = options.look;
    this.tier = options.tier;
    this.e = initialExplode;
    this.frame = heartFrameFrom(manifest?.heart);
    setBeatFrame(this.frame);
    this.shared = createSharedUniforms(getRiskLUT());
    this.shared.clip.uClipCentre.value.set(...PULMONARY_CLIP.centre);
    this.shared.clip.uClipRadius.value = PULMONARY_CLIP.radius;
    this.shared.clip.uClipFeather.value = PULMONARY_CLIP.feather;
    this.shared.clipGreat.uClipCentre.value.set(...GREAT_VESSEL_CLIP.centre);
    this.shared.clipGreat.uClipRadius.value = GREAT_VESSEL_CLIP.radius;
    this.shared.clipGreat.uClipFeather.value = GREAT_VESSEL_CLIP.feather;
    this.assembly = new AssemblyClock(!options.assemble);

    const specs = manifest ? buildExplodeSpecs(manifest as unknown as ManifestLike, this.frame) : new Map<string, ExplodeSpec>();
    const structures = new Map((manifest?.structures ?? []).map((s) => [s.node, s]));

    const layerIdOfNode = new Map<string, string>();
    for (const l of manifest?.layers ?? []) {
      layerIdOfNode.set(l.node, l.id);
      for (const n of (l.nodes as string[] | undefined) ?? []) layerIdOfNode.set(n, l.id);
    }

    root.updateWorldMatrix(true, true);
    const rootInverse = root.matrixWorld.clone().invert();
    // The cardiac veins, the LAD and the RCA each straddle the heart's cut plane: split them there, like a
    // specimen cut in two, so the anterior veins (the AIV), the LAD in the anterior interventricular groove and
    // the RCA in the right AV groove open WITH the anterior half instead of hanging over the opened chambers,
    // while the LAD's proximal stretch at the left main and the RCA's crux end stay on the posterior half.
    for (const node of SPLIT_AT_CUT) splitAtCutPlane(root, rootInverse, node, this.frame, specs);
    for (const node of SPLIT_BY_PIECE) splitAtCutPlane(root, rootInverse, node, this.frame, specs, true);
    adoptWallTips(root, rootInverse, specs);
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof Mesh && !o.userData.ctGhost) meshes.push(o);
    });

    for (const mesh of meshes) {
      let layerNode = '';
      for (let p: Object3D | null = mesh.parent; p; p = p.parent) if (p.name.startsWith('Layer_')) layerNode ||= p.name;
      const node = mesh.name || mesh.parent?.name || '';
      const kind = classifyNode(node, layerNode);
      // A split half answers to the structure it was cut from (label, definition, `_VEIN` codes).
      const s = structures.get(node) ?? structures.get(mesh.userData.ctSplitFrom as string);
      const layerId = s?.layer ?? layerIdOfNode.get(node) ?? layerIdOfNode.get(layerNode) ?? layerNode.replace(/^Layer_/, '').toLowerCase();
      let target: TargetId | null = null;
      for (let p: Object3D | null = mesh; p && !target; p = p.parent) target = options.nodeTargets.get(p.name) ?? null;
      // A split part answers to the vessel it was cut from (risk colour, selection, picking).
      target ??= options.nodeTargets.get(mesh.userData.ctSplitFrom as string) ?? null;
      const restWorld = rootInverse.clone().multiply(mesh.matrixWorld);
      const restOffset = new Vector3().setFromMatrixPosition(restWorld);
      const restMatrix = mesh.matrix.clone();
      const spec = specs.get(node) ?? null;
      const maps = bakedMaps(mesh.material);

      if (SMOOTH_KINDS.has(kind)) smoothNormals(mesh.geometry as BufferGeometry);
      if (kind === 'myocardium' && !mesh.geometry.getAttribute('aCavity')) {
        // Filled in idle time by computeCavities(); zeros = no darkening until then.
        const count = mesh.geometry.getAttribute('position').count;
        mesh.geometry.setAttribute('aCavity', new BufferAttribute(new Float32Array(count * 3), 3));
      }
      mesh.matrixAutoUpdate = false;
      mesh.userData.ctTarget = target;
      mesh.userData.ctKind = kind;
      mesh.raycast = () => {};
      mesh.renderOrder = kind === 'coronary' || kind === 'leftMain' ? 1 : 0;

      const ghost = createGhostMaterial(kind, this.look, restOffset, this.shared, GREAT_VESSEL_KINDS.has(kind));
      const ghostMesh = new Mesh(mesh.geometry as BufferGeometry, ghost);
      ghostMesh.name = `${node}__ghost`;
      ghostMesh.userData.ctGhost = true;
      ghostMesh.raycast = () => {};
      ghostMesh.visible = false;
      ghostMesh.renderOrder = 10;
      ghostMesh.frustumCulled = mesh.frustumCulled;
      mesh.add(ghostMesh);

      const entry: RigEntry = {
        mesh,
        ghostMesh,
        node,
        kind,
        layerId,
        target,
        structureId: s?.id ?? node,
        label: s?.label ?? node,
        restMatrix,
        restOffset,
        spec,
        wall: null,
        stage: stageById(assemblyStageOf(kind, node)),
        flyIn: { vector: new Vector3(), hinge: null },
        flyInFrom: null,
        maps,
        mapsReady: !maps,
        solid: new Map(),
        ghost,
        solidAmt: 0,
        ghostAmt: 0,
        assemblyMatrix: new Matrix4(),
        assemblyReveal: 1,
        explodeMatrix: new Matrix4(),
        pickable: false,
      };
      this.entries.push(entry);
      this.byNode.set(node, entry);
    }

    // Riders and fly-in vectors (a rider copies its wall's assembly so it never detaches mid-flight).
    for (const entry of this.entries) {
      const rides = entry.spec?.rides ?? null;
      if (rides) entry.wall = specs.get(rides) ?? null;
      const wallEntry = rides ? this.byNode.get(rides) ?? null : null;
      if (wallEntry) {
        entry.flyInFrom = wallEntry;
        entry.stage = wallEntry.stage;
      } else {
        const v = entry.spec?.vector ?? new Vector3();
        entry.flyIn = { vector: v.lengthSq() > 0.0025 ? v.clone() : defaultFlyIn(entry.kind, entry.restOffset), hinge: entry.spec?.hinge ?? null };
      }
    }

    // Before the first material: the great vessels' shaders read `aBeatW` and the straightened `_dist_heart`, the
    // fat's reads `aDeflate`.
    this.straightenVesselCuts();
    this.cutDescendingAorta();
    this.assignBeatWeights();
    this.assignFatDeflate();
    for (const entry of this.entries) {
      entry.mesh.material = this.solidFor(entry);
      entry.solidAmt = 0;
    }
    this.publishFraming(rootInverse);
    sceneRuntime.anatomyReady = true;
    sceneRuntime.sectionPlanes = this.sectionPlanes;
  }

  /**
   * Surface samples for the camera (sceneRuntime.framing): the heart walls at rest, the great-vessel parts
   * the clip spheres leave visible, and the heart walls with everything riding them at full explode (the
   * camera fits the opened heart into the free area).
   */
  private publishFraming(rootInverse: Matrix4): void {
    const heart: Vector3[] = [];
    const keep: Vector3[] = [];
    const open: Vector3[] = [];
    // Each open sample's rest position and peel window, so the camera can frame the heart at ANY peel value
    // while it opens or closes (framing.ts `openPointsAt`), not only at full explode.
    const openRest: Vector3[] = [];
    const openWindow: (readonly [number, number])[] = [];
    const restWorld = new Matrix4();
    const openDelta = new Matrix4();
    const v = new Vector3();
    const sample = (entry: RigEntry, budget: number, each: (p: Vector3) => void) => {
      const pos = (entry.mesh.geometry as BufferGeometry).getAttribute('position');
      if (!pos) return;
      restWorld.copy(rootInverse).multiply(entry.mesh.matrixWorld);
      const step = Math.max(1, Math.floor(pos.count / budget));
      for (let i = 0; i < pos.count; i += step) each(v.fromBufferAttribute(pos, i).applyMatrix4(restWorld));
    };
    // "Visible" = inside the clean cut halfway through the feather (shaders.ts: the trimmed vessels end in a cut).
    const visibleIn = (clip: { centre: readonly number[]; radius: number; feather: number }, p: Vector3) =>
      Math.hypot(p.x - clip.centre[0]!, p.y - clip.centre[1]!, p.z - clip.centre[2]!) < clip.radius - clip.feather * 0.5;
    // A great vessel's vertex is visible when it is before every cut its material applies (shaders.ts): the
    // along-the-wall cut (halfway through the fade band) and/or the sphere.
    const sampleVisible = (entry: RigEntry, budget: number, each: (p: Vector3) => void) => {
      const k = entry.kind;
      const geometry = entry.mesh.geometry as BufferGeometry;
      const pos = geometry.getAttribute('position');
      const along = geometry.getAttribute('_dist_heart');
      const fade = ALONG_FADE[k];
      const limit = fade ? fade[0] + 0.5 * (fade[1] - fade[0]) : 0;
      const useAlong = !!(along && fade);
      const sphere = k === 'pulmonaryArtery' || k === 'pulmonaryVeins' ? PULMONARY_CLIP : GREAT_VESSEL_CLIP;
      const useSphere = !useAlong || ALONG_KEEPS_SPHERE.has(k);
      restWorld.copy(rootInverse).multiply(entry.mesh.matrixWorld);
      const step = Math.max(1, Math.floor(pos.count / budget));
      for (let i = 0; i < pos.count; i += step) {
        if (useAlong && along!.getX(i) >= limit) continue;
        const p = v.fromBufferAttribute(pos, i).applyMatrix4(restWorld);
        if (!useSphere || visibleIn(sphere, p)) each(p);
      }
    };
    for (const entry of this.entries) {
      const k = entry.kind;
      if (k === 'myocardium') sample(entry, 500, (p) => heart.push(p.clone()));
      else if (k === 'aorta' || k === 'systemicVein' || k === 'pulmonaryArtery' || k === 'pulmonaryVeins')
        sampleVisible(entry, 300, (p) => keep.push(p.clone()));
      const vessel = k === 'aorta' || k === 'systemicVein' || k === 'pulmonaryArtery' || k === 'pulmonaryVeins';
      if (k === 'myocardium' || k === 'fat' || k === 'coronary' || k === 'leftMain' || vessel) {
        const spec = entry.spec;
        const wall = entry.wall;
        if (spec && wall) riderDelta(spec, wall, 1, 1, openDelta);
        else if (spec) explodeDelta(spec, 1, openDelta);
        else openDelta.identity();
        const win = (wall ?? spec)?.window ?? ([0.7, 1] as const);
        const push = (p: Vector3) => {
          openRest.push(p.clone());
          open.push(p.clone().applyMatrix4(openDelta));
          openWindow.push(win);
        };
        if (vessel) sampleVisible(entry, 120, push);
        else sample(entry, k === 'myocardium' ? 500 : 120, push);
      }
    }
    const f = sceneRuntime.framing;
    f.heart = heart;
    f.keep = keep;
    f.open = open;
    f.openRest = openRest;
    f.openWindow = openWindow;
    f.version += 1;
  }

  private solidFor(entry: RigEntry): TissueMaterial {
    const key = `${this.look}-${this.tier}-${entry.mapsReady ? 'm' : ''}`;
    let m = entry.solid.get(key);
    if (!m) {
      const heart = BEATS_WITH_HEART.has(entry.kind) || GREAT_VESSEL_KINDS.has(entry.kind);
      const geometry = entry.mesh.geometry as BufferGeometry;
      m = createTissueMaterial({
        kind: entry.kind,
        look: this.look,
        tier: this.tier,
        restOffset: entry.restOffset,
        beatMode: beatModeOf(entry.kind),
        shared: this.shared,
        territoryAttribute: entry.kind === 'myocardium' ? (geometry.getAttribute('color') ? 'color' : null) : null,
        maps: entry.mapsReady ? entry.maps : null,
        clippingPlanes: heart ? this.sectionPlanes : null,
        inflate: (entry.kind === 'coronary' || entry.kind === 'leftMain') && !INTRAMURAL.has(entry.node) ? VESSEL_INFLATE : 0,
        cavity: !!geometry.getAttribute('aCavity'),
        along: !!geometry.getAttribute('_dist_heart'),
        beatWeighted: !!geometry.getAttribute('aBeatW'),
        deflateField: !!geometry.getAttribute('aDeflate'),
        enclosure: !!geometry.getAttribute('_enclosure'),
      });
      entry.solid.set(key, m);
    }
    return m;
  }

  /**
   * Specimen cuts for the pulmonary vessels (vesselCuts.ts): `_dist_heart` becomes the distance past each
   * vessel's root along its own direction, so `ALONG_FADE` trims the trunk and each vein with a clean plane
   * (the published geodesic field zig-zags across a vessel and left ragged rims).
   */
  private straightenVesselCuts(): void {
    for (const e of this.entries) {
      const band = ALONG_FADE[e.kind];
      const g = e.mesh.geometry as BufferGeometry;
      const along = g.getAttribute('_dist_heart');
      if (!band || !along || e.kind !== 'pulmonaryArtery') continue;
      const pos = g.getAttribute('position');
      const p = new Float32Array(pos.count * 3);
      const a = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i += 1) {
        p[i * 3] = pos.getX(i);
        p[i * 3 + 1] = pos.getY(i);
        p[i * 3 + 2] = pos.getZ(i);
        a[i] = along.getX(i);
      }
      const cut = (band[0] + band[1]) / 2;
      const out = straightCutDistance(p, g.index ? g.index.array : null, a, {
        rootBand: VESSEL_CUT_ROOT,
        axisBand: [cut * 0.45, cut * 0.9],
        margin: VESSEL_CUT_MARGIN,
      });
      g.setAttribute('_dist_heart', new BufferAttribute(out, 1));
    }
  }

  /**
   * The descending aorta is cut away below the arch, as on a heart specimen; the ascending aorta keeps its sphere
   * clip (ALONG_KEEPS_SPHERE). The sphere cut the descending limb's posterior wall obliquely and left an oval
   * window through which the left atrium showed, and the limb hid the left atrium and the coronary sinus from
   * behind. Its `_dist_heart` (absent from the GLB) becomes the depth below a plane across the descending limb.
   */
  private cutDescendingAorta(): void {
    const e = this.byNode.get('GreatVessel_Aorta');
    if (!e) return;
    const g = e.mesh.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    const base = this.frame.base;
    const out = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i += 1) {
      const behind = base.z - (pos.getZ(i) + e.restOffset.z); // posterior of the AV-plane centre
      const up = pos.getY(i) + e.restOffset.y - base.y;
      // The limb behind the heart up to the arch, and everything below the AV plane (only the descending aorta
      // reaches there; it comes forward on its way to the diaphragm).
      out[i] = Math.max(behind > DESCENDING_AORTA.behind ? DESCENDING_AORTA.cutAbove - up : -1, DESCENDING_AORTA.floor - up);
    }
    g.setAttribute('_dist_heart', new BufferAttribute(out, 1));
  }

  /**
   * `aBeatW` on every great vessel (beatWeights.ts): 1 where it joins the heart wall, fading to 0 along its own
   * wall, so its junction beats exactly like the chamber it opens into and its far end stays still.
   */
  private assignBeatWeights(): void {
    const L = this.frame.length;
    const touch = L * BEAT_WEIGHT_TOUCH;
    const wall = new PointHash(touch * 4);
    for (const e of this.entries) {
      if (e.kind !== 'myocardium') continue;
      const pos = (e.mesh.geometry as BufferGeometry).getAttribute('position');
      const pts = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        pts[i * 3] = pos.getX(i) + e.restOffset.x;
        pts[i * 3 + 1] = pos.getY(i) + e.restOffset.y;
        pts[i * 3 + 2] = pos.getZ(i) + e.restOffset.z;
      }
      wall.add(pts);
    }
    const p = new Vector3();
    const height = (x: number, y: number, z: number) => heightOf(this.frame, p.set(x, y, z));
    for (const e of this.entries) {
      const o = VESSEL_BEAT_WEIGHTS[e.kind];
      if (!o) continue;
      const g = e.mesh.geometry as BufferGeometry;
      if (g.getAttribute('aBeatW')) continue;
      const pos = g.getAttribute('position');
      const rest = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        rest[i * 3] = pos.getX(i) + e.restOffset.x;
        rest[i * 3 + 1] = pos.getY(i) + e.restOffset.y;
        rest[i * 3 + 2] = pos.getZ(i) + e.restOffset.z;
      }
      const w = vesselBeatWeights(rest, g.index ? g.index.array : null, wall, height, {
        full: o.full * L,
        fade: o.fade * L,
        touch,
        maxSeedHeight: o.maxSeedHeight,
      });
      g.setAttribute('aBeatW', new BufferAttribute(w, 1));
    }
  }

  /**
   * `aDeflate` on the epicardial fat (fatDeflate.ts): its pull-in direction (tissue.ts `FAT_DEFLATE`) as a function
   * of position, the same in both halves where they meet at the cut, so the fat closes over its seam at rest.
   */
  private assignFatDeflate(): void {
    const fat = this.entries.filter((e) => e.kind === 'fat');
    if (fat.length === 0 || fat.every((e) => (e.mesh.geometry as BufferGeometry).getAttribute('aDeflate'))) return;
    const parts = fat.map((e) => {
      const g = e.mesh.geometry as BufferGeometry;
      const pos = g.getAttribute('position');
      const positions = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        positions[i * 3] = pos.getX(i);
        positions[i * 3 + 1] = pos.getY(i);
        positions[i * 3 + 2] = pos.getZ(i);
      }
      return { positions, index: g.index ? g.index.array : null, offset: [e.restOffset.x, e.restOffset.y, e.restOffset.z] as const };
    });
    const { cutPoint: p, cutNormal: n } = this.frame;
    const dirs = deflateDirections(parts, { point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] }, { band: FAT_SEAM_BAND });
    fat.forEach((e, k) => (e.mesh.geometry as BufferGeometry).setAttribute('aDeflate', new BufferAttribute(dirs[k]!, 3)));
  }

  /** Every coronary material of a target (all looks / tiers built so far), for the risk animation. */
  vesselMaterials(target: string): TissueMaterial[] {
    const out: TissueMaterial[] = [];
    for (const e of this.entries) if (e.target === target && (e.kind === 'coronary' || e.kind === 'leftMain')) out.push(...e.solid.values());
    return out;
  }

  vesselTargets(): string[] {
    return [...new Set(this.entries.filter((e) => e.target).map((e) => e.target as string))];
  }

  setLook(look: SceneLook): void {
    if (look === this.look) return;
    this.look = look;
    for (const e of this.entries) {
      e.mesh.material = this.solidFor(e);
      setGhostLook(e.ghost, e.kind, look);
    }
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier || tier === 'D') return;
    this.tier = tier;
    for (const e of this.entries) e.mesh.material = this.solidFor(e);
  }

  /** Mark a mesh's baked maps as uploaded: its Realistic materials are rebuilt with them. */
  markMapsReady(entry: RigEntry): void {
    if (entry.mapsReady) return;
    entry.mapsReady = true;
    entry.mesh.material = this.solidFor(entry);
  }

  /**
   * Textures to upload in idle time after load (CONTRACTS §7.1), one entry at a time: the heart, its vessels,
   * valves and fat. The outer layers (skin, muscle, ribs, lungs, diaphragm) rest as ghosts, which never
   * sample a map, so theirs wait until the layer actually turns solid (`nextSolidWithoutMaps`) — about a
   * third of the GLB's texture memory is never uploaded in a normal session.
   */
  pendingTextures(): { entry: RigEntry; textures: Texture[] }[] {
    // The walls first, then what lies on them (fat, veins), so nothing switches from its procedural look to
    // its bake long after the heart has settled.
    const order = (e: RigEntry) => {
      const i = TEXTURE_ORDER.indexOf(e.kind);
      return i < 0 ? TEXTURE_ORDER.length : i;
    };
    return this.entries
      .filter((e) => !e.mapsReady && e.maps && !OUTER_KINDS.has(e.kind))
      .sort((a, b) => order(a) - order(b))
      .map((e) => ({ entry: e, textures: texturesOf(e) }));
  }

  /** An outer-layer mesh that is turning solid without its baked maps yet (upload them now, one a frame). */
  nextSolidWithoutMaps(): { entry: RigEntry; textures: Texture[] } | null {
    for (const e of this.entries) if (!e.mapsReady && e.maps && OUTER_KINDS.has(e.kind) && e.solidAmt > 1e-3) return { entry: e, textures: texturesOf(e) };
    return null;
  }

  /**
   * Re-assign the right-ventricular free wall's supplied territory to the RCA (territory.ts): the GLB's
   * COLOR_0 gives it to the LAD. Needs the centrelines (the grooves' angles); in place, once per geometry.
   */
  correctTerritories(vessels: readonly { id?: string; segments: readonly { points: readonly (readonly number[])[] }[] }[]): void {
    const trunk = (id: string, lo: number, hi: number): Vector3[] => {
      const pts = vessels.find((v) => v.id === id)?.segments[0]?.points ?? [];
      return pts.slice(Math.floor(pts.length * lo), Math.max(Math.floor(pts.length * lo) + 1, Math.floor(pts.length * hi))).map((q) => new Vector3(q[0], q[1], q[2]));
    };
    const frame = { apex: this.frame.apex, axis: this.frame.axis, length: this.frame.length };
    const lad = meanAngle(frame, trunk('LAD', 0.2, 0.8));
    const pda = meanAngle(frame, trunk('RCA_PDA', 0.2, 0.9));
    const margin = meanAngle(frame, trunk('RCA_MARGINAL', 0.3, 1));
    if (lad === null || pda === null || margin === null) return;
    const arc = { lad, pda, margin };
    const p = new Vector3();
    for (const e of this.entries) {
      if (e.kind !== 'myocardium') continue;
      const g = e.mesh.geometry as BufferGeometry;
      const col = g.getAttribute('color');
      const pos = g.getAttribute('position');
      if (!col || !pos || g.userData.ctRvTerritory) continue;
      g.userData.ctRvTerritory = true;
      for (let i = 0; i < pos.count; i += 1) {
        const share = rvShare(arc, axial(frame, p.fromBufferAttribute(pos, i).add(e.restOffset)));
        if (share <= 1e-3) continue;
        const [r, gg, b] = correctWeights([col.getX(i), col.getY(i), col.getZ(i)], share);
        col.setXYZ(i, r, gg, b);
      }
      const target = (col as { data?: { needsUpdate: boolean } }).data ?? col;
      target.needsUpdate = true;
    }
  }

  /**
   * Fill the heart walls' `aCavity` attribute (crease AO, vessel grooves, fat along the arteries) from the
   * mesh and the coronary centrelines. One wall per call: schedule the calls in idle time.
   */
  cavityJobs(centrelines: readonly { segments: readonly { points: readonly (readonly number[])[]; radius?: readonly number[] }[] }[]): (() => void)[] {
    const points: CentrelinePoint[] = [];
    for (const v of centrelines)
      for (const seg of v.segments)
        seg.points.forEach((q, i) => points.push({ x: q[0]!, y: q[1]!, z: q[2]!, r: seg.radius?.[i] ?? 0.012 }));
    return this.entries
      .filter((e) => e.kind === 'myocardium')
      .map((e) => () => {
        if (this.disposed) return;
        const g = e.mesh.geometry as BufferGeometry;
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const attr = g.getAttribute('aCavity') as BufferAttribute | undefined;
        if (!pos || !nor || !attr) return;
        const n = pos.count;
        const positions = new Float32Array(n * 3);
        const normals = new Float32Array(n * 3);
        const o = e.restOffset;
        for (let i = 0; i < n; i += 1) {
          positions[i * 3] = pos.getX(i) + o.x;
          positions[i * 3 + 1] = pos.getY(i) + o.y;
          positions[i * 3 + 2] = pos.getZ(i) + o.z;
          normals[i * 3] = nor.getX(i);
          normals[i * 3 + 1] = nor.getY(i);
          normals[i * 3 + 2] = nor.getZ(i);
        }
        const index = g.index ? (g.index.array as ArrayLike<number>) : null;
        (attr.array as Float32Array).set(cavityAttribute({ positions, normals, index, vertexCount: n }, points));
        attr.needsUpdate = true;
      });
  }

  /** Displayed peel scalar (after the spring). */
  get explode(): number {
    return this.e;
  }

  /** Per frame. Returns true while anything is still moving (demand-mode renders another frame). */
  update(inp: RigInputs): boolean {
    if (this.disposed) return false;
    const dt = Math.min(Math.max(inp.dt, 0), 0.1);
    let moving = false;
    FRAME_UNIFORMS.uCtFrame.value = (FRAME_UNIFORMS.uCtFrame.value + 1) % 64;

    // Assembly clock (only while the canvas is on a page). It runs on wall-clock time — a slow or throttled
    // frame loop never stretches it — and it never rests half-materialised: after the warm-up frames (which
    // compile the programs and may stall), a gap longer than ASSEMBLY_GAP_S (the page was not composited,
    // nobody saw it) finishes it, and a sustained frame rate under 20 fps skips to the end (SKIP_FINISH_S).
    if (inp.stage !== 'hidden') {
      if (inp.reduced) this.assembly.finish();
      if (!this.assembly.done) {
        const warm = this.assemblyTicks++ < ASSEMBLY_WARMUP_FRAMES;
        const raw = warm ? Math.min(Math.max(0, inp.dt), 1 / 30) : Math.max(0, inp.dt);
        if (raw > ASSEMBLY_GAP_S) this.assembly.finish();
        else {
          this.frameEma = this.frameEma * 0.8 + raw * 0.2;
          if (!warm && this.frameEma > 1 / 20) this.assembly.skip();
          this.assembly.tick(raw);
        }
        moving = true;
      }
    }
    const at = this.assembly.t;
    sceneRuntime.assembly.t = at;
    sceneRuntime.assembly.done = this.assembly.done;
    sceneRuntime.assembly.playing = !this.assembly.done && inp.stage !== 'hidden';
    FRAME_UNIFORMS.uCtEdgeGain.value = sceneRuntime.assembly.playing ? 1 : 0;

    // Peel spring (critically damped, no overshoot).
    if (inp.reduced) {
      this.e = inp.explodeTarget;
      this.ev = 0;
    } else {
      [this.e, this.ev] = springStep(this.e, this.ev, inp.explodeTarget, PEEL_SPRING_OMEGA, dt);
      if (Math.abs(this.e - inp.explodeTarget) < 1e-4 && Math.abs(this.ev) < 1e-4) {
        this.e = inp.explodeTarget;
        this.ev = 0;
      } else moving = true;
    }
    const heartOpen = windowProgress(this.e, [0.7, 1]);
    sceneRuntime.peel.e = this.e;
    sceneRuntime.peel.heartOpen = heartOpen;

    // Beat: one displacement field in the rest frame, applied in the vertex shaders (beatDeform.ts).
    setBeatActivation(inp.beatV, inp.beatA);

    // Section plane: keep the posterior side of the cut plane (+ depth), glide in and out.
    const sTarget = inp.section ? inp.sectionDepth : SECTION_OFF;
    this.sectionS = inp.reduced ? sTarget : damp(this.sectionS, sTarget, LAMBDA_SECTION, dt);
    if (Math.abs(this.sectionS - sTarget) > 1e-3) moving = true;
    const n = this.frame.cutNormal;
    this.sectionPlanes[0]!.normal.copy(n).negate();
    this.sectionPlanes[0]!.constant = n.dot(this.frame.cutPoint) + this.sectionS;
    // The closed heart's chambers are dark; light reaches them as the halves part or a section cuts in (and once
    // the walls stop being solid, below).
    const heartLit = Math.max(smooth01(heartOpen / 0.35), 1 - smooth01((this.sectionS - 0.4) / 0.4));

    const sel = inp.selected;
    const chestAway = inp.stage === 'workstation' && this.e >= PEEL_CHEST_AWAY;

    // Great-vessel clip sphere: tighter while a vessel is selected (GREAT_VESSEL_CLIP_SELECTED), gliding.
    const clipGoal = (sel || inp.trimGreatVessels) && inp.stage === 'workstation' ? GREAT_VESSEL_CLIP_SELECTED : GREAT_VESSEL_CLIP;
    const clip = this.shared.clipGreat;
    const kClip = inp.reduced ? 1 : 1 - Math.exp(-LAMBDA_SECTION * dt);
    clip.uClipCentre.value.x += (clipGoal.centre[0] - clip.uClipCentre.value.x) * kClip;
    clip.uClipCentre.value.y += (clipGoal.centre[1] - clip.uClipCentre.value.y) * kClip;
    clip.uClipCentre.value.z += (clipGoal.centre[2] - clip.uClipCentre.value.z) * kClip;
    clip.uClipRadius.value += (clipGoal.radius - clip.uClipRadius.value) * kClip;
    clip.uClipFeather.value += (clipGoal.feather - clip.uClipFeather.value) * kClip;
    if (Math.abs(clip.uClipRadius.value - clipGoal.radius) > 1e-3) moving = true;
    const k = (dtLambda: number) => (inp.reduced ? 1 : 1 - Math.exp(-dtLambda * dt));
    const fadeK = k(LAMBDA_FADE);

    // ---- assembly pose: walls (and everything flying on its own) first, then the riders copy their wall's
    // pose of THIS frame - never last frame's, which on the first frame would show the fat, veins and
    // coronaries fully materialised in front of a wall that has not appeared yet.
    for (const entry of this.entries) {
      if (entry.flyInFrom) continue;
      if (this.assembly.done) {
        entry.assemblyMatrix.identity();
        entry.assemblyReveal = 1;
      } else {
        const pose = stagePose(entry.stage, at);
        explodeDelta(entry.flyIn, pose.offset, entry.assemblyMatrix, false);
        entry.assemblyReveal = pose.reveal;
      }
    }
    for (const entry of this.entries) {
      if (!entry.flyInFrom) continue;
      entry.assemblyMatrix.copy(entry.flyInFrom.assemblyMatrix);
      entry.assemblyReveal = entry.flyInFrom.assemblyReveal;
    }

    for (const entry of this.entries) {
      // ---- explode delta
      const spec = entry.spec;
      let kPeel = 0;
      if (spec && entry.wall) {
        const kWall = windowProgress(this.e, entry.wall.window);
        kPeel = windowProgress(this.e, spec.window);
        riderDelta(spec, entry.wall, kWall, kPeel, entry.explodeMatrix);
      } else if (spec) {
        kPeel = windowProgress(this.e, spec.window);
        explodeDelta(spec, kPeel, entry.explodeMatrix);
      } else entry.explodeMatrix.identity();

      // ---- matrix: E · A · R (the beat runs in the vertex shaders)
      const m = entry.mesh.matrix;
      m.copy(entry.restMatrix);
      m.premultiply(entry.assemblyMatrix);
      m.premultiply(entry.explodeMatrix);
      entry.mesh.matrixWorldNeedsUpdate = true;

      // ---- visibility targets
      const outer = OUTER_KINDS.has(entry.kind);
      const peeled = outer && peeledAt(entry.layerId, this.e, entry.node);
      // Every layer defaults to visible: the lungs are solid in the closed chest and part during the
      // dissection; at the rest detent they are set aside with the rest of the thorax (chestAway below).
      const layerVisible = inp.layerVisibility[entry.layerId] ?? true;
      const isVessel = entry.kind === 'coronary' || entry.kind === 'leftMain';
      const selectedVessel = !!sel && (entry.target === sel || (entry.kind === 'leftMain' && (sel === 'LAD' || sel === 'LCX')));
      // Isolate keeps the heart itself (walls, the great-vessel roots and, in Realistic, the epicardial fat)
      // with the vessel: an organ, not a maroon blob with open annuli.
      const isolateMember =
        entry.kind === 'myocardium' ||
        selectedVessel ||
        entry.kind === 'aorta' ||
        entry.kind === 'pulmonaryArtery' ||
        (entry.kind === 'fat' && inp.look === 'realistic');
      let solidT = 1;
      let ghostT = 0;
      // Valves and papillary muscles live inside the chambers: they appear as the heart opens or is cut
      // (the pulmonary valve would otherwise poke through the BodyParts3D outflow tract).
      const inner = (entry.kind === 'valve' || entry.kind === 'papillary') && heartOpen < 0.02 && !inp.section;
      // The left atrium carries its own four pulmonary-vein ostia (thick, cleanly cut stumps); the separate
      // BodyParts3D vein trees do not line up with them and, trimmed near the heart, doubled them into ragged
      // clusters and claw-like crescents. The atrium's ostia stand for the cut veins, as on a specimen.
      const hiddenTree = entry.kind === 'pulmonaryVeins';
      if (!layerVisible || inner || hiddenTree || (inp.isolate && sel && !isolateMember) || (entry.kind === 'cardiacVein' && !inp.showVeins)) {
        solidT = 0;
      } else if (entry.kind === 'fat' && inp.look === 'clinical') {
        // Clinical: the fat is a translucent ghost over the clay, so the coronaries in their grooves are never
        // hidden or out-shone by it.
        solidT = 0;
        ghostT = inp.isolate && sel ? 0 : 1;
      } else if (entry.kind === 'cardiacVein' && inp.look === 'clinical') {
        // Clinical: a translucent overlay, visibly "not modelled", never a solid tube that could be mistaken
        // for a low-risk artery (LUMEN §7.3: 20 % opacity). Realistic shows them solid in a greyed venous
        // plum from the baked maps (tissue.ts), out of bloom and risk colour.
        solidT = 0;
        ghostT = 1;
      } else if (entry.kind === 'skin') {
        // The closed chest shows the torso's contour (a clear fresnel ghost), fading as the skin peels.
        solidT = 0;
        ghostT = inp.ghostLayers || kPeel < 0.5 ? (1 - 0.85 * kPeel) * (inp.stage === 'workstation' ? SKIN_GHOST : 1) : 0;
      } else if (peeled || (entry.kind === 'lung' && inp.look === 'clinical')) {
        solidT = 0;
        ghostT = peeled && !inp.ghostLayers ? 0 : inp.stage === 'workstation' ? workstationGhost(entry.kind) : HERO_LUNG_GHOST;
        // A peeled diaphragm has dropped under the heart, onto the toolbar: no warm glow there.
        if (peeled && entry.kind === 'diaphragm' && inp.stage === 'workstation') ghostT = 0;
      } else if (inp.ghostOthers && sel && !selectedVessel && !outer) {
        solidT = 0;
        ghostT = isVessel ? 0.7 : entry.kind === 'myocardium' ? 1 : 0.6;
      }
      // Landing hero (V2 §6.1): the heart unboxed with the lungs as its only fresnel ghost — no skin, muscle,
      // rib, cartilage, diaphragm or bronchial-tree ghosts drifting in front of the lens or behind the copy.
      if (inp.stage === 'hero' && outer && entry.kind !== 'lung') ghostT = 0;
      // Workstation with the chest open (Lungs aside, Open heart): the thorax has been set aside, so its
      // ghosts leave the stage (no muddy smears at the frame's edges or behind the cards, and ~120 k fewer
      // overdrawn triangles every frame). They come back as soon as the peel closes the chest again, and a
      // layer switched on by hand in Layers keeps its ghost.
      if (chestAway && outer && inp.layerVisibility[entry.layerId] !== true) ghostT = 0;
      entry.solidAmt += (solidT - entry.solidAmt) * fadeK;
      entry.ghostAmt += (ghostT - entry.ghostAmt) * fadeK;
      if (Math.abs(entry.solidAmt - solidT) < 2e-3) entry.solidAmt = solidT;
      else moving = true;
      if (Math.abs(entry.ghostAmt - ghostT) < 2e-3) entry.ghostAmt = ghostT;
      else moving = true;

      const solidVisible = entry.solidAmt * entry.assemblyReveal;
      const material = entry.mesh.material as TissueMaterial;
      material.userData.ct.uniforms.uReveal.value = solidVisible;
      // A chest layer fades with alpha only WHILE it fades: fully solid it is an opaque draw (depth-sorted
      // with the heart, never behind a transparent great vessel by object-centre sorting).
      if (material.userData.ct.flags.fadeAlpha && material.opacity >= 0.999) {
        const blend = solidVisible < 0.995;
        if (material.transparent !== blend) {
          material.transparent = blend;
          material.needsUpdate = true;
        }
      }
      // Hide the solid by making the node's own draw invisible while keeping its ghost child: a zero reveal
      // discards every fragment, so switch the material's visibility rather than the object's.
      material.visible = solidVisible > 0.002;
      const ghostVisible = entry.ghostAmt * entry.assemblyReveal;
      entry.ghostMesh.visible = ghostVisible > 0.002;
      // A node that shows nothing is hidden outright, so anything following it (fx overlays and flow,
      // which test node visibility) disappears with it: isolate, hidden layers, the assembly's first frames.
      entry.mesh.visible = solidVisible > 0.002 || ghostVisible > 0.002;
      entry.ghost.userData.ct.uniforms.uFade.value = ghostVisible;
      entry.pickable = PICKABLE_KINDS.has(entry.kind) && solidVisible > 0.5 && entry.mesh.visible;
      const pub = sceneRuntime.nodes[entry.node] ?? (sceneRuntime.nodes[entry.node] = { solid: 0, ghost: 0 });
      pub.solid = solidVisible;
      pub.ghost = ghostVisible;
    }

    // ...and with walls ghosted, isolated away or not yet assembled, what lies inside is in plain view: lit.
    let wallSolid = 1;
    for (const e of this.entries) if (e.kind === 'myocardium') wallSolid = Math.min(wallSolid, e.solidAmt * e.assemblyReveal);
    this.shared.interior.uHeartOpen.value = Math.max(heartLit, 1 - wallSolid);

    return moving;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const e of this.entries) {
      for (const m of e.solid.values()) m.dispose();
      e.solid.clear();
      e.ghost.dispose();
      e.mesh.remove(e.ghostMesh);
    }
    sceneRuntime.anatomyReady = false;
  }
}

/** Kinds whose solid material carries risk colour (vessel targets). */
export const isVesselKind = (kind: TissueKind) => kind === 'coronary' || kind === 'leftMain';
export { CLIPPED_TREE_KINDS, ANTERIOR_SUFFIX };
