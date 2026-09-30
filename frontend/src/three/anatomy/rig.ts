/**
 * The anatomy rig: owns every GLB mesh's materials, transforms and visibility, per frame, without React
 * state. GlbAnatomy builds one per loaded scene and calls `update()` from useFrame.
 *
 * Per mesh the displayed matrix is   M = E · A · B · R
 *   R  rest local matrix (each GLB node is centred on itself; R carries its rest offset)
 *   B  affine ventricular beat in the heart's rest frame (heart walls, valves, coronaries, cardiac veins)
 *   A  cold-load assembly fly-in (explode direction, anterior half re-closing its hinge)
 *   E  peel / exploded view: layer + structure vectors, the anterior half's hinge, riders follow their wall
 * so a coronary that rides a wall shares E, A and B with it and can never detach. Every mesh also gets a
 * ghost twin (same geometry, additive fresnel) so solid ↔ ghost transitions crossfade instead of popping.
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
import { BEAT_UNIFORMS, beatMatrix, setBeatFrame } from './beatDeform';
import { cavityAttribute, type CentrelinePoint } from './cavity';
import { FRAME_UNIFORMS } from './shaders';
import {
  BEATS_WITH_HEART,
  CLIPPED_TREE_KINDS,
  OUTER_KINDS,
  PICKABLE_KINDS,
  assemblyStageOf,
  beatModeOf,
  classifyNode,
  type TissueKind,
} from './classify';
import {
  OPENING_WALL,
  PEEL_SOLID_UNTIL,
  PEEL_SPRING_OMEGA,
  buildExplodeSpecs,
  explodeDelta,
  heartFrameFrom,
  riderDelta,
  springStep,
  windowProgress,
  type ExplodeSpec,
  type HeartFrame,
  type ManifestLike,
} from './explode';
import {
  ALONG_FADE,
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
  beats: boolean;
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
 * Outer ghosts in the workstation stay faint (V2 §5.15: α ≤ 0.12, "clean silhouette"): bone and cartilage
 * sit right behind and around the heart, so they are the faintest (≤ 2 % over the stage); skin, muscle and
 * the diaphragm keep a trace of the thorax at the frame's edges.
 */
const workstationGhost = (kind: TissueKind) => (kind === 'bone' || kind === 'cartilage' ? 0.15 : 0.3);
/** Landing hero lung ghost strength: a trace of context, never a smear behind the copy or the cards. */
const HERO_LUNG_GHOST = 0.55;
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

/** Nodes split at the heart's cut plane at load (the anterior part rides the opening wall). */
const SPLIT_VEINS = 'CardiacVeins';
export const ANTERIOR_SUFFIX = '_Anterior';

/**
 * Split `node` (one mesh, riding the posterior wall) at the heart's cut plane: triangles whose centroid lies
 * on the opening side (+cut normal) move to a sibling mesh `<node>_Anterior` that shares the vertex buffers
 * (and so the `_VEIN` codes and baked maps) and rides the anterior wall with its explode vector. Idempotent
 * (a rebuilt rig on the same scene finds the sibling already there).
 */
function splitAtCutPlane(root: Object3D, rootInverse: Matrix4, node: string, frame: HeartFrame, specs: Map<string, ExplodeSpec>, wall: string): void {
  const name = `${node}${ANTERIOR_SUFFIX}`;
  let found: Mesh | null = null;
  let done = false;
  root.traverse((o) => {
    if (o.name === name) done = true;
    if (!found && o instanceof Mesh && !o.userData.ctGhost && (o.name === node || (!o.name && o.parent?.name === node))) found = o;
  });
  const source = found as Mesh | null;
  const base = specs.get(node);
  const wallSpec = specs.get(wall);
  if (source && base && wallSpec && !specs.has(name)) {
    specs.set(name, { ...base, node: name, vector: wallSpec.vector.clone(), rides: wall, hinge: null });
  }
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
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = at(i);
    const ib = at(i + 1);
    const ic = at(i + 2);
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
  private readonly beatM = new Matrix4();
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
    // The cardiac veins are one GLB node on the posterior wall: split them at the heart's cut plane so the
    // anterior veins (the AIV beside the LAD, the anterior cardiac veins) open with the anterior half instead
    // of floating across the opened chambers.
    splitAtCutPlane(root, rootInverse, SPLIT_VEINS, this.frame, specs, OPENING_WALL);
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

      const ghost = createGhostMaterial(kind, this.look, restOffset, this.shared);
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
        beats: BEATS_WITH_HEART.has(kind),
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
    // "Visible" = the clip fade still leaves ≥ 10 % alpha (alpha = keep², keep = 1 − smoothstep over the feather).
    const visibleIn = (clip: { centre: readonly number[]; radius: number; feather: number }, p: Vector3) =>
      Math.hypot(p.x - clip.centre[0]!, p.y - clip.centre[1]!, p.z - clip.centre[2]!) < clip.radius - clip.feather * 0.35;
    for (const entry of this.entries) {
      const k = entry.kind;
      if (k === 'myocardium') sample(entry, 500, (p) => heart.push(p.clone()));
      else if (k === 'aorta' || k === 'systemicVein') sample(entry, 300, (p) => visibleIn(GREAT_VESSEL_CLIP, p) && keep.push(p.clone()));
      else if (k === 'pulmonaryArtery' || k === 'pulmonaryVeins') {
        const along = (entry.mesh.geometry as BufferGeometry).getAttribute('_dist_heart');
        const fade = ALONG_FADE[k];
        if (along && fade) {
          // Visible = the along-the-wall fade still leaves ≥ 10 % alpha.
          const pos = (entry.mesh.geometry as BufferGeometry).getAttribute('position');
          restWorld.copy(rootInverse).multiply(entry.mesh.matrixWorld);
          const step = Math.max(1, Math.floor(pos.count / 300));
          const limit = fade[0] + 0.35 * (fade[1] - fade[0]);
          for (let i = 0; i < pos.count; i += step) if (along.getX(i) < limit) keep.push(v.fromBufferAttribute(pos, i).applyMatrix4(restWorld).clone());
        } else sample(entry, 300, (p) => visibleIn(PULMONARY_CLIP, p) && keep.push(p.clone()));
      }
      const vessel = k === 'aorta' || k === 'systemicVein' || k === 'pulmonaryArtery' || k === 'pulmonaryVeins';
      if (k === 'myocardium' || k === 'fat' || k === 'coronary' || k === 'leftMain' || vessel) {
        const spec = entry.spec;
        const wall = entry.wall;
        if (spec && wall) riderDelta(spec, wall, 1, 1, openDelta);
        else if (spec) explodeDelta(spec, 1, openDelta);
        else openDelta.identity();
        const clip = k === 'pulmonaryArtery' || k === 'pulmonaryVeins' ? PULMONARY_CLIP : GREAT_VESSEL_CLIP;
        const along = (entry.mesh.geometry as BufferGeometry).getAttribute('_dist_heart');
        const fade = ALONG_FADE[k];
        if (vessel && along && fade) {
          const pos = (entry.mesh.geometry as BufferGeometry).getAttribute('position');
          restWorld.copy(rootInverse).multiply(entry.mesh.matrixWorld);
          const step = Math.max(1, Math.floor(pos.count / 120));
          const limit = fade[0] + 0.35 * (fade[1] - fade[0]);
          for (let i = 0; i < pos.count; i += step)
            if (along.getX(i) < limit) open.push(v.fromBufferAttribute(pos, i).applyMatrix4(restWorld).clone().applyMatrix4(openDelta));
        } else
          sample(entry, k === 'myocardium' ? 500 : 120, (p) => {
            if (!vessel || visibleIn(clip, p)) open.push(p.clone().applyMatrix4(openDelta));
          });
      }
    }
    const f = sceneRuntime.framing;
    f.heart = heart;
    f.keep = keep;
    f.open = open;
    f.version += 1;
  }

  private solidFor(entry: RigEntry): TissueMaterial {
    const key = `${this.look}-${this.tier}-${entry.mapsReady ? 'm' : ''}`;
    let m = entry.solid.get(key);
    if (!m) {
      const heart = BEATS_WITH_HEART.has(entry.kind) || entry.kind === 'aorta' || entry.kind === 'pulmonaryArtery' || entry.kind === 'pulmonaryVeins' || entry.kind === 'systemicVein';
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
        inflate: entry.kind === 'coronary' || entry.kind === 'leftMain' ? VESSEL_INFLATE : 0,
        cavity: !!geometry.getAttribute('aCavity'),
        along: !!geometry.getAttribute('_dist_heart'),
      });
      entry.solid.set(key, m);
    }
    return m;
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

    // Beat (rest frame).
    beatMatrix(this.frame, inp.beatV, this.beatM);
    BEAT_UNIFORMS.uBeatMatrix.value.copy(this.beatM);
    BEAT_UNIFORMS.uBeatAtrial.value = inp.beatA;

    // Section plane: keep the posterior side of the cut plane (+ depth), glide in and out.
    const sTarget = inp.section ? inp.sectionDepth : SECTION_OFF;
    this.sectionS = inp.reduced ? sTarget : damp(this.sectionS, sTarget, LAMBDA_SECTION, dt);
    if (Math.abs(this.sectionS - sTarget) > 1e-3) moving = true;
    const n = this.frame.cutNormal;
    this.sectionPlanes[0]!.normal.copy(n).negate();
    this.sectionPlanes[0]!.constant = n.dot(this.frame.cutPoint) + this.sectionS;

    const sel = inp.selected;
    const chestAway = inp.stage === 'workstation' && this.e >= PEEL_CHEST_AWAY;
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

      // ---- matrix: E · A · B · R
      const m = entry.mesh.matrix;
      m.copy(entry.restMatrix);
      if (entry.beats) m.premultiply(this.beatM);
      m.premultiply(entry.assemblyMatrix);
      m.premultiply(entry.explodeMatrix);
      entry.mesh.matrixWorldNeedsUpdate = true;

      // ---- visibility targets
      const outer = OUTER_KINDS.has(entry.kind);
      const peeled = outer && kPeel >= PEEL_SOLID_UNTIL;
      const layerDefault = entry.layerId === 'lungs' ? inp.stage === 'hero' : true;
      const layerVisible = inp.layerVisibility[entry.layerId] ?? layerDefault;
      const isVessel = entry.kind === 'coronary' || entry.kind === 'leftMain';
      const selectedVessel = !!sel && (entry.target === sel || (entry.kind === 'leftMain' && (sel === 'LAD' || sel === 'LCX')));
      const isolateMember = entry.kind === 'myocardium' || selectedVessel;
      let solidT = 1;
      let ghostT = 0;
      // Valves and papillary muscles live inside the chambers: they appear as the heart opens or is cut
      // (the pulmonary valve would otherwise poke through the BodyParts3D outflow tract).
      const inner = (entry.kind === 'valve' || entry.kind === 'papillary') && heartOpen < 0.02 && !inp.section;
      if (!layerVisible || inner || (inp.isolate && sel && !isolateMember) || (entry.kind === 'cardiacVein' && !inp.showVeins)) {
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
        solidT = 0;
        ghostT = inp.ghostLayers || kPeel < 0.5 ? (1 - 0.85 * kPeel) * (inp.stage === 'workstation' ? workstationGhost(entry.kind) : 1) : 0;
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
export { CLIPPED_TREE_KINDS };
