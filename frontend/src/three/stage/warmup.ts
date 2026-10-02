/**
 * Shader warm-up: compile every program a scene will draw BEFORE the frame that first draws it — on the browser's
 * own compiler threads where it has them (KHR_parallel_shader_compile) — so the page never freezes on a compile.
 *
 * WHY: three.js compiles a program synchronously on its first draw. On Windows (ANGLE → Direct3D 11) one tissue
 * program takes 0.1–0.4 s: the anatomy's first frame compiled 15 of them and froze the page for ~2.8 s, and every
 * later first draw (a textured variant, a tier switch) froze it again while the cold-load assembly played, which
 * then skipped itself (rig.ts: a sustained frame rate under 20 fps finishes it).
 *
 * `renderer.compileAsync` alone keys some programs differently from the real draw, so they would compile twice:
 *  - it compiles under whatever clipping state the last draw left behind, and every heart material carries the
 *    section plane (one clipping plane): the materials are compiled in groups of equal clipping-plane count, each
 *    right after a 1×1 draw that leaves exactly that state;
 *  - it compiles for the current render target, and the post chain draws the scene into one (linear output, no
 *    tone mapping): with `intoTarget` it compiles into a 1×1 target.
 * Then each program's first use (its uniform table) is taken one at a time between yields, so a browser without
 * parallel compilation still never blocks the page for more than one program at a time.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';

interface ProgramLike {
  isReady(): boolean;
  getUniforms(): unknown;
}

type Drawable = Object3D & { material: Material | Material[] };

function isDrawable(o: Object3D): o is Drawable {
  const d = o as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean; material?: unknown };
  return !!(d.isMesh || d.isPoints || d.isLine || d.isSprite) && !!d.material;
}

/** A stand-in drawable with the same class, geometry and flags as `o` but one material (never added to a scene). */
function proxyOf(o: Drawable, material: Material): Object3D | null {
  try {
    const p = o.clone(false) as Drawable;
    p.material = material;
    return p;
  } catch {
    return null;
  }
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Materials whose programs are built per slice. */
const CHUNK = 4;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One degenerate triangle: drawn into the 1×1 target only to leave the renderer's clipping state behind. */
let clipProbe: { geometry: BufferGeometry; scenes: Map<string, Scene> } | null = null;
function clipStateScene(planes: number, intersect: boolean): Scene {
  clipProbe ??= {
    geometry: new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)),
    scenes: new Map(),
  };
  const key = `${planes}:${intersect ? 1 : 0}`;
  let scene = clipProbe.scenes.get(key);
  if (!scene) {
    const material = new MeshBasicMaterial({ clipIntersection: intersect });
    if (planes > 0) material.clippingPlanes = Array.from({ length: planes }, () => new Plane(new Vector3(0, 0, 1), 1e6));
    const mesh = new Mesh(clipProbe.geometry, material);
    mesh.frustumCulled = false;
    scene = new Scene();
    scene.add(mesh);
    clipProbe.scenes.set(key, scene);
  }
  return scene;
}

export interface WarmOptions {
  /** Compile for an offscreen render target (the post chain draws the scene into one). */
  intoTarget: boolean;
  /**
   * Compile these (object, material) pairs instead of what the scene draws now: materials a later interaction will
   * swap in (another look, a layer turning solid), warmed in the background before anyone asks for them.
   */
  pairs?: readonly { object: Object3D; material: Material }[];
  /** Share of the programs ready so far, 0..1. */
  onProgress?: (share: number) => void;
  /** Stop early (the scene went away). */
  cancelled?: () => boolean;
}

/**
 * Programs of every material drawn in `scene` (or of `opts.pairs`), compiled for the real draw state. Resolves once
 * all are usable.
 */
export async function warmPrograms(gl: WebGLRenderer, scene: Scene, camera: Camera, opts: WarmOptions): Promise<number> {
  const groups = new Map<string, { planes: number; intersect: boolean; proxies: Object3D[] }>();
  const seen = new Set<Material>();
  const add = (o: Drawable, m: Material | undefined) => {
    if (!m || seen.has(m)) return;
    seen.add(m);
    const planes = gl.localClippingEnabled ? m.clippingPlanes?.length ?? 0 : 0;
    const intersect = planes > 0 && m.clipIntersection;
    const key = `${planes}:${intersect ? 1 : 0}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { planes, intersect, proxies: [] }));
    const proxy = proxyOf(o, m);
    if (proxy) group.proxies.push(proxy);
  };
  if (opts.pairs) {
    for (const { object, material } of opts.pairs) if (isDrawable(object)) add(object, material);
  } else {
    scene.traverse((o) => {
      if (!isDrawable(o)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) add(o, m);
    });
  }

  // Building a program's source costs a few ms on the main thread: a few materials per slice, each slice right
  // after its own clipping-state draw (frames drawn in between change that state).
  const chunks: { planes: number; intersect: boolean; proxies: Object3D[] }[] = [];
  for (const g of groups.values())
    for (let i = 0; i < g.proxies.length; i += CHUNK) chunks.push({ planes: g.planes, intersect: g.intersect, proxies: g.proxies.slice(i, i + CHUNK) });
  const target = opts.intoTarget ? new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true }) : null;
  const materials = new Set<Material>();
  try {
    for (let c = 0; c < chunks.length && !opts.cancelled?.(); c += 1) {
      const chunk = chunks[c]!;
      const previous = gl.getRenderTarget();
      try {
        gl.setRenderTarget(target);
        gl.render(clipStateScene(chunk.planes, chunk.intersect), camera);
        const root = new Group();
        for (const proxy of chunk.proxies) root.add(proxy);
        for (const m of gl.compile(root, camera, scene)) materials.add(m);
      } finally {
        gl.setRenderTarget(previous);
      }
      opts.onProgress?.((0.3 * (c + 1)) / chunks.length);
      await yieldToBrowser();
    }
  } finally {
    target?.dispose();
  }

  const programs: ProgramLike[] = [];
  for (const m of materials) {
    const props = gl.properties.get(m) as { programs?: Map<string, ProgramLike> };
    for (const p of props.programs?.values() ?? []) if (!programs.includes(p)) programs.push(p);
  }
  const total = programs.length;
  if (total === 0) return 0;

  // Wait for the compiler threads, then take each program's first use (uniform table) one per slice.
  let pending = programs.slice();
  while (pending.length > 0 && !opts.cancelled?.()) {
    pending = pending.filter((p) => !p.isReady());
    opts.onProgress?.(0.3 + 0.5 * (1 - pending.length / total));
    if (pending.length > 0) await sleep(16);
  }
  for (let i = 0; i < programs.length && !opts.cancelled?.(); i += 1) {
    programs[i]!.getUniforms();
    opts.onProgress?.(0.8 + (0.2 * (i + 1)) / total);
    await yieldToBrowser();
  }
  return total;
}
