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
  update: (...args: never[]) => boolean;
  __hidden?: Set<string>;
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

  /** Nodes hidden after the rig's own per-frame visibility pass (the rig re-shows everything each frame). */
  const hidden = (): Set<string> | null => {
    const r = rig();
    if (!r) return null;
    if (!r.__hidden) {
      const own = r.update.bind(r);
      const set = new Set<string>();
      r.__hidden = set;
      r.update = ((...args: never[]) => {
        const moving = own(...args);
        for (const n of set) {
          const e = r.byNode.get(n);
          if (e) e.mesh.visible = false;
        }
        return moving;
      }) as RigLike['update'];
    }
    return r.__hidden;
  };

  const grab = (): Uint8ClampedArray => {
    void frames(1, 0);
    const src = gl.domElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    if (!ctx) return new Uint8ClampedArray(0);
    ctx.drawImage(src, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height).data;
  };

  /**
   * Colour statistics of the pixels `nodes` cover on screen (a frame with them minus a frame without):
   * mean luminance, chroma (max − min) and hue — e.g. "is the fat darker and less chromatic than the
   * coronaries" (V2 §10 3D criteria).
   */
  const stats = (nodes: readonly string[]) => {
    const set = hidden();
    if (!set) return null;
    const base = grab();
    for (const n of nodes) set.add(n);
    const without = grab();
    for (const n of nodes) set.delete(n);
    grab();
    let count = 0;
    let lum = 0;
    let chroma = 0;
    let hx = 0;
    let hy = 0;
    for (let i = 0; i < base.length; i += 16) {
      if (Math.abs(base[i]! - without[i]!) + Math.abs(base[i + 1]! - without[i + 1]!) + Math.abs(base[i + 2]! - without[i + 2]!) <= 30) continue;
      const r = base[i]! / 255;
      const g = base[i + 1]! / 255;
      const b = base[i + 2]! / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      chroma += mx - mn;
      if (mx > mn) {
        const h = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
        hx += Math.cos((h * Math.PI) / 3);
        hy += Math.sin((h * Math.PI) / 3);
      }
      count += 1;
    }
    const round = (x: number) => Math.round(x * 1000) / 1000;
    return { px: count, lum: round(lum / Math.max(1, count)), chroma: round(chroma / Math.max(1, count)), hue: Math.round(((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360) };
  };

  Object.assign(target, {
    probe,
    box,
    zoom,
    unzoom: () => document.getElementById('__ct-zoom')?.remove(),
    peel,
    stats,
    hide: (nodes: readonly string[], on = true) => {
      const set = hidden();
      for (const n of nodes) {
        if (on) set?.add(n);
        else set?.delete(n);
      }
    },
  });
}
