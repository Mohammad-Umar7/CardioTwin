/**
 * Occlusion tests for label anchors and best views (WORKSTATION_V2 P0-2). A trunk point can face the camera
 * and still hide behind the atrial appendage or the pulmonary trunk; a ray from the eye to the point that
 * hits the heart wall, a valve or a great vessel first says so. Only meshes whose BVH is already built are
 * tested (three-mesh-bvh, built lazily by the anatomy's picker), so a test never falls back to a
 * brute-force pass over 55 k triangles; with no BVH yet the callers fall back to the facing heuristic.
 */
import { Raycaster, Vector3, type Mesh, type Object3D } from 'three';

/** Tissue that can hide an epicardial artery from the camera (anatomy rig kinds). */
const OCCLUDER_KINDS = new Set(['myocardium', 'valve', 'papillary', 'aorta', 'pulmonaryArtery', 'pulmonaryVeins', 'systemicVein']);
/**
 * A hit this close in front of the point is the vessel's own bed, not an occluder: the centrelines run
 * 5–13 mm under the epicardial fat and the wall surface of their groove (measured on the BodyParts3D
 * meshes: RCA ~5 mm, the LCX deep in the AV groove ~13 mm). Real occluders — the left atrium over the
 * proximal LCX, the pulmonary trunk — sit 2–5 cm in front.
 */
const SURFACE_TOLERANCE = 0.14;

type BvhGeometry = { boundsTree?: unknown };

/**
 * Visible occluder meshes — all of them, or none: while some BVHs are still being built (the picker builds
 * them in idle slices), a partial set would call hidden points visible, so the callers keep the facing
 * heuristic until every occluder is ready.
 */
export function collectOccluders(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  let pending = false;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !OCCLUDER_KINDS.has(mesh.userData.ctKind as string) || mesh.userData.ctGhost) return;
    for (let p: Object3D | null = mesh; p; p = p.parent) if (!p.visible) return;
    if (!(mesh.geometry as BvhGeometry | undefined)?.boundsTree) pending = true;
    else out.push(mesh);
  });
  return pending ? [] : out;
}

const raycaster = new Raycaster();
(raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
const dir = new Vector3();

/** True when a ray from `eye` to `point` hits one of `occluders` clearly before reaching the point. */
export function isOccluded(eye: Vector3, point: Vector3, occluders: readonly Mesh[]): boolean {
  if (occluders.length === 0) return false;
  dir.copy(point).sub(eye);
  const dist = dir.length();
  if (dist < 1e-6) return false;
  raycaster.set(eye, dir.multiplyScalar(1 / dist));
  raycaster.near = 0;
  raycaster.far = Math.max(0, dist - SURFACE_TOLERANCE);
  return raycaster.intersectObjects(occluders as Mesh[], false).length > 0;
}
