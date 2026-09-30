/**
 * Dev / `?ctdebug` probes on `window.__ct` (never used by the app): measure the framing, magnify the canvas
 * and step the peel on a page whose rAF is throttled (hidden pane, background tab), so reviewers can check
 * the V2 §10 3D criteria without a visible browser.
 *
 *   __ct.probe(['Heart_Wall_Anterior'])  projected bbox (canvas px) of nodes + the free area
 *   __ct.zoom(x0, y0, x1, y1)            renders a frame and paints that canvas region over the page (1 layer)
 *   __ct.unzoom()                        removes the magnifier
 *   __ct.peel(from, to, ms, every)       drives viewerStore.explode along the peel easing, frame by frame,
 *                                        sampling probe() every `every` ms
 */
import { Vector3, type Camera, type Mesh, type WebGLRenderer } from 'three';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';

interface RigLike {
  byNode: Map<string, { mesh: Mesh }>;
  explode: number;
}

export interface Box2 {
  l: number;
  r: number;
  t: number;
  b: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

const WALLS = ['Heart_Wall_Anterior', 'Heart_Wall_Posterior'];

export function installProbes(target: Record<string, unknown>, gl: WebGLRenderer, camera: Camera, frames: (n?: number, ms?: number) => Promise<void>): void {
  const rig = () => (window as unknown as { __ctRig?: RigLike }).__ctRig ?? null;
  const v = new Vector3();

  const box = (nodes: readonly string[]): Box2 | null => {
    const r = rig();
    if (!r) return null;
    const W = gl.domElement.clientWidth;
    const H = gl.domElement.clientHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const e = r.byNode.get(n);
      if (!e || !e.mesh.visible) continue;
      e.mesh.updateMatrixWorld(true);
      const pos = e.mesh.geometry.getAttribute('position');
      const step = Math.max(1, Math.floor(pos.count / 1500));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(e.mesh.matrixWorld).project(camera);
        const x = ((v.x + 1) / 2) * W;
        const y = ((1 - v.y) / 2) * H;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) return null;
    const round = Math.round;
    return { l: round(minX), r: round(maxX), t: round(minY), b: round(maxY), w: round(maxX - minX), h: round(maxY - minY), cx: round((minX + maxX) / 2), cy: round((minY + maxY) / 2) };
  };

  const probe = (nodes: readonly string[] = WALLS) => {
    const W = gl.domElement.clientWidth;
    const H = gl.domElement.clientHeight;
    const i = useUiStore.getState().stageInsets;
    const w = W - i.left - i.right;
    const h = H - i.top - i.bottom;
    return {
      free: { x: i.left, y: i.top, w, h, cx: Math.round(i.left + w / 2), cy: Math.round(i.top + h / 2) },
      box: box(nodes),
      e: Math.round((rig()?.explode ?? NaN) * 1000) / 1000,
      cam: camera.position.toArray().map((c) => Math.round(c * 100) / 100),
    };
  };

  const zoom = async (x0: number, y0: number, x1: number, y1: number) => {
    const src = gl.domElement;
    const rect = src.getBoundingClientRect();
    let overlay = document.getElementById('__ct-zoom') as HTMLCanvasElement | null;
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.id = '__ct-zoom';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;width:100vw;height:100vh;pointer-events:none';
      document.body.appendChild(overlay);
    }
    overlay.width = innerWidth;
    overlay.height = innerHeight;
    // Render now and copy in the same task: the drawing buffer is not preserved across frames.
    await frames(1, 0);
    const sx = src.width / rect.width;
    const w = x1 - x0;
    const h = y1 - y0;
    const s = Math.min(innerWidth / w, innerHeight / h);
    const ctx = overlay.getContext('2d');
    if (!ctx) return 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.drawImage(src, (x0 - rect.left) * sx, (y0 - rect.top) * sx, w * sx, h * sx, 0, 0, w * s, h * s);
    return s;
  };

  const peel = async (from: number, to: number, ms: number, every = 200, nodes: readonly string[] = WALLS) => {
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const out: unknown[] = [];
    let last = -Infinity;
    const n = Math.ceil(ms / 16);
    for (let k = 0; k <= n; k += 1) {
      const t = Math.min(1, (k * 16) / ms);
      useViewerStore.getState().setExplode(from + (to - from) * ease(t));
      await frames(1, 16);
      if (k * 16 - last >= every) {
        last = k * 16;
        const p = probe(nodes);
        out.push({ ms: k * 16, e: p.e, cam: p.cam, ...p.box });
      }
    }
    return out;
  };

  Object.assign(target, { probe, box, zoom, unzoom: () => document.getElementById('__ct-zoom')?.remove(), peel });
}
