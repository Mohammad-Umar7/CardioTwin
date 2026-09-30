import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import { useManifest, useSchemaIndex, useVessels } from '@/hooks/useData';
import { useUiStore, type Chrome } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { anchorsVersion, getAnchors } from '../anatomy/anchors';
import { BEAT_UNIFORMS } from '../anatomy/beatDeform';
import { BEATS_WITH_HEART, type TissueKind } from '../anatomy/classify';
import { ANTERIOR_SUFFIX, cutSide, isSplitNode } from '../anatomy/cutSplit';
import { heartFrameFrom } from '../anatomy/explode';
import { useCameraState } from '../camera/cameraState';
import { collectOccluders, isOccluded } from '../camera/occlusion';
import { freeArea, heartBox } from '../camera/framing';
import { sceneRuntime } from '../stage/sceneRuntime';
import { buildTracks, heartAxisFrame, restToDisplayed, type AnchorTrack } from './anchorTracks';
import { facing } from './dynamicAnchor';
import {
  chamberEls,
  chamberFade,
  coverFade,
  dotEls,
  glideToward,
  labelEls,
  labelSizes,
  layoutLanes,
  layoutRow,
  lineEls,
  resolveLane,
  type ChamberId,
  type LaneItem,
} from './labelRegistry';

const DEFAULT_TARGETS = ['LAD', 'LCX', 'RCA'];
/** Anchor window of the RCA's trunk (its visible acute-margin stretch included). */
const RCA_ANCHOR_WINDOW: readonly [number, number] = [0.06, 0.85];
/** Labels fade in LAD → LCX → RCA, 60 ms apart, once the coronaries ignite (V2 §5.14). */
const REVEAL_STAGGER_MS = 60;
/** Room kept free above the lanes: the context slot (selection chip / what-if pill, 12 + 32) or, in focus
 * mode, the answer pill at the top right (12 + 40 + 8). */
const CONTEXT_SLOT_ROOM = 44;
const ANSWER_PILL_ROOM = 60;
/** Share of the heart box's projected width that the organ's silhouette actually covers. */
const SILHOUETTE = 0.95;
/** The two heart halves (their union is "the heart" for the label layout while it opens). */
const HALVES = ['Heart_Wall_Anterior', 'Heart_Wall_Posterior'] as const;

interface ChamberAnchor {
  id: ChamberId;
  /** Valve node the anchor is defined on (it moves with that node). */
  node: string;
  /** Anchor in the node's local frame. */
  local: Vector3;
}

/** Anchor glide when the chosen candidate changes (per-second rate of an exponential approach). */
const ANCHOR_GLIDE = 14;

const projected = new Vector3();
const eye = new Vector3();
const tmpPos = new Vector3();
const tmpNormal = new Vector3();
const displayed = new Matrix4();
const displayedFront = new Matrix4();

/** Writes a style / attribute only when it changed (the projector runs every frame). */
const cache = new WeakMap<Element, Record<string, string>>();
function put(el: Element, key: string, value: string, write: () => void) {
  let c = cache.get(el);
  if (!c) cache.set(el, (c = {}));
  if (c[key] === value) return;
  c[key] = value;
  write();
}
/** Opacity as a short, stable string ("0.4", not "0.39999…"), so the write cache hits. */
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const setStyle = (el: HTMLElement | SVGElement, prop: 'transform' | 'opacity' | 'transitionDelay', value: string) =>
  put(el, prop, value, () => {
    el.style[prop] = value;
  });
const setData = (el: HTMLElement, key: string, value: string) =>
  put(el, `data-${key}`, value, () => {
    el.dataset[key] = value;
  });
const setAttr = (el: Element, key: string, value: string) =>
  put(el, `@${key}`, value, () => {
    if (value === '') el.removeAttribute(key);
    else el.setAttribute(key, value);
  });

interface Resolved {
  id: string;
  anchor: Vector3;
  /** Facing of the anchor point toward the camera (> 0 = front side). */
  facing: number;
  /** How visible the vessel itself is (its node's solid share: isolate, ghosting, assembly). */
  solid: number;
}


/**
 * Canvas-side half of the vessel labels (WORKSTATION_V2 §5.14). Every frame it
 *   - resolves each vessel's anchor: a dynamic, camera-facing point of the proximal–mid trunk (re-chosen
 *     at most every 200 ms, with hysteresis), carried through the peel and the assembly but not the beat;
 *     the anatomy's static anchors are the fallback (procedural heart, missing centrelines);
 *   - lays the labels out in radiological lanes just outside the heart, inside `uiStore.stageInsets`
 *     (never under a card, never clipped), ≥ 28 px apart, leaders never crossing;
 *   - applies the states: the selected label at full strength with a solid leader (never "behind"), the
 *     others at 40 % with dashed leaders, far-side unselected labels marked "(behind)";
 *   - writes straight into the overlay's DOM nodes (no React state).
 */
export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const manifest = useManifest().data;
  const vessels = useVessels().data;
  const schema = useSchemaIndex();
  const targets = useMemo(() => schema?.vessels.map((t) => t.id) ?? DEFAULT_TARGETS, [schema]);
  // The RCA wraps the right AV groove: at home its proximal stretch hides behind the right atrial appendage,
  // so its label may also anchor on the acute margin (proximal-distal 85 %) instead of flipping to "(behind)"
  // depending on which candidate the chooser held last.
  const tracks = useMemo(
    () => [
      ...buildTracks(manifest, vessels, targets.filter((t) => t !== 'RCA')),
      ...buildTracks(manifest, vessels, targets.filter((t) => t === 'RCA'), RCA_ANCHOR_WINDOW, 16),
    ],
    [manifest, vessels, targets],
  );
  const box = useMemo(() => heartBox(manifest), [manifest]);
  const corners = useMemo(() => {
    const { min, max } = box;
    const out: Vector3[] = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push(new Vector3(x, y, z));
    return out;
  }, [box]);

  const state = useRef({
    meshes: new Map<string, Object3D | null>(),
    meshVersion: -1,
    meshCheckedAt: 0,
    shown: new Map<string, Vector3>(),
    revealAt: 0,
    lastChrome: '' as Chrome | '',
    occluders: [] as Mesh[],
    occludersAt: -Infinity,
    chambers: null as ChamberAnchor[] | null,
    /** Layout the labels are in ('row' at Open heart, else 'lanes') and where each label is drawn. */
    layout: 'lanes' as 'row' | 'lanes',
    gliding: false,
    drawn: new Map<string, { left: number; top: number; edgeX: number; edgeY: number }>(),
  });
  const axis = useMemo(() => heartAxisFrame(manifest), [manifest]);
  const cut = useMemo(() => heartFrameFrom(manifest?.heart), [manifest]);

  /** Occluders with a ready BVH, refreshed once a second (hidden layers drop out). */
  const occludersFor = (now: number): Mesh[] => {
    const s = state.current;
    if (now - s.occludersAt > 1000) {
      s.occluders = collectOccluders(scene);
      s.occludersAt = now;
    }
    return s.occluders;
  };

  const nodeMesh = (node: string, now: number): Object3D | null => {
    const s = state.current;
    const version = anchorsVersion();
    if (version !== s.meshVersion || (now - s.meshCheckedAt > 1000 && [...s.meshes.values()].some((m) => !m))) {
      s.meshVersion = version;
      s.meshCheckedAt = now;
      s.meshes.clear();
      s.chambers = null;
    }
    if (!s.meshes.has(node)) {
      let found: Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.name === node && typeof o.userData.ctKind === 'string' && !o.userData.ctGhost) found = o;
      });
      s.meshes.set(node, found);
    }
    return s.meshes.get(node) ?? null;
  };
  const meshFor = (track: AnchorTrack, now: number): Object3D | null => nodeMesh(track.node, now);

  /**
   * Chamber anchors (local to their valve mesh): the chordae tips of the mitral / tricuspid apparatus — the
   * lowest few percent of the valve's vertices along the long axis — name the ventricles; their annulus top,
   * nudged toward the base, the atria.
   */
  const chamberAnchors = (now: number): ChamberAnchor[] => {
    const s = state.current;
    if (s.chambers) return s.chambers;
    const out: ChamberAnchor[] = [];
    for (const [node, low, high] of [
      ['Valve_Mitral', 'LV', 'LA'],
      ['Valve_Tricuspid', 'RV', 'RA'],
    ] as const) {
      const mesh = nodeMesh(node, now) as Mesh | null;
      const pos = mesh?.geometry?.getAttribute('position');
      if (!mesh || !pos) continue;
      // The valve node's local frame is its rest frame translated (no rotation): heights along the long axis.
      const ranked: { h: number; i: number }[] = [];
      for (let i = 0; i < pos.count; i += 1) ranked.push({ h: tmpPos.fromBufferAttribute(pos, i).dot(axis.axis), i });
      ranked.sort((a, b) => a.h - b.h);
      const mean = (from: number, to: number) => {
        const v = new Vector3();
        for (let k = from; k < to; k += 1) v.add(tmpPos.fromBufferAttribute(pos, ranked[k]!.i));
        return v.divideScalar(Math.max(1, to - from));
      };
      const n = Math.max(1, Math.floor(ranked.length * 0.03));
      out.push({ id: low, node, local: mean(0, n) });
      out.push({ id: high, node, local: mean(ranked.length - n, ranked.length).addScaledVector(axis.axis, 0.04) });
    }
    if (out.length > 0) s.chambers = out;
    return out;
  };

  /** Screen box (canvas px) of both heart halves as displayed now, from their geometry bounds. */
  const halvesExtent = (now: number) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of HALVES) {
      const mesh = nodeMesh(node, now) as Mesh | null;
      const g = mesh?.geometry;
      if (!mesh || !g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      mesh.updateWorldMatrix(true, false);
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            projected.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
            const px = ((projected.x + 1) / 2) * size.width;
            const py = ((1 - projected.y) / 2) * size.height;
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
    }
    if (!Number.isFinite(minX)) return null;
    // Box corners overshoot a rotated half's silhouette: trim like the closed heart (95 %).
    const cxx = (minX + maxX) / 2;
    const cyy = (minY + maxY) / 2;
    const hx = ((maxX - minX) / 2) * SILHOUETTE;
    const hy = ((maxY - minY) / 2) * SILHOUETTE;
    return { minX: cxx - hx, maxX: cxx + hx, minY: cyy - hy, maxY: cyy + hy };
  };

  useFrame((_, delta) => {
    const now = performance.now();
    const viewer = useViewerStore.getState();
    const ui = useUiStore.getState();
    const s = state.current;
    const { width, height } = size;
    // The controls moved the camera earlier in this frame; project with this frame's matrices, not the
    // last render's, so labels never trail a camera flight.
    camera.updateMatrixWorld();
    eye.copy(camera.position);

    // Reveal after the first anatomy frame and the coronary ignition (never before there is a heart).
    const assembly = sceneRuntime.assembly;
    const ignited = assembly.done || assembly.t >= assembly.igniteAt;
    const ready = useCameraState.getState().firstFrame && viewer.stage !== 'hidden' && (ignited || !sceneRuntime.anatomyReady);
    if (!ready) s.revealAt = 0;
    else if (s.revealAt === 0) s.revealAt = now;
    const visible = viewer.labels && ready;

    // 1. Anchors: dynamic camera-facing trunk points, else the anatomy's static anchors.
    const resolved: Resolved[] = [];
    const statics = getAnchors();
    for (const id of targets) {
      const track = tracks.find((t) => t.target === id);
      const mesh = track?.centre ? meshFor(track, now) : null;
      let anchor: Vector3 | null = null;
      let face = 1;
      if (track && track.centre && mesh) {
        const kind = mesh.userData.ctKind as TissueKind;
        const beat = BEATS_WITH_HEART.has(kind) ? BEAT_UNIFORMS.uBeatMatrix.value : null;
        restToDisplayed(mesh, track.centre, beat, displayed);
        // A vessel split at the cut plane (cutSplit.ts): its opening-side trunk rides the anterior half.
        const front = isSplitNode(track.node) ? nodeMesh(`${track.node}${ANTERIOR_SUFFIX}`, now) : null;
        if (front) restToDisplayed(front, track.centre, beat, displayedFront);
        const matrixOf = (rest: Vector3) => (front && cutSide(cut, rest.toArray()) > 0 ? displayedFront : displayed);
        const pick = track.chooser.update(now, () => {
          // Facing the camera first; a facing point hidden behind an atrium or a great vessel ranks below
          // every unobstructed one (P0-2: the label points at something the viewer can see).
          const occluders = occludersFor(now);
          return track.candidates.map((c) => {
            const m = matrixOf(c.rest);
            tmpPos.copy(c.rest).applyMatrix4(m);
            tmpNormal.copy(c.normal).transformDirection(m);
            const f = facing(tmpPos, tmpNormal, eye);
            return f > 0 && isOccluded(eye, tmpPos, occluders) ? f - 1.5 : f;
          });
        });
        const c = track.candidates[Math.max(0, pick)]!;
        const m = matrixOf(c.rest);
        anchor = tmpPos.copy(c.rest).applyMatrix4(m).clone();
        face = facing(anchor, tmpNormal.copy(c.normal).transformDirection(m), eye);
        // Hidden by another structure at the last evaluation counts as "behind".
        if ((track.chooser.scores[pick] ?? 0) < -0.5) face = Math.min(face, -0.01);
      } else {
        const a = statics.get(id);
        if (a) {
          anchor = a.position.clone();
          face = facing(a.position, a.normal, eye);
        }
      }
      if (!anchor) continue;
      // Glide to a newly chosen anchor instead of jumping.
      const shown = s.shown.get(id);
      if (!shown || !visible) s.shown.set(id, anchor);
      else shown.lerp(anchor, 1 - Math.exp(-ANCHOR_GLIDE * Math.min(0.1, delta)));
      const node = track?.node ? sceneRuntime.nodes[track.node] : undefined;
      resolved.push({ id, anchor: s.shown.get(id)!, facing: face, solid: node ? Math.min(1, node.solid) : 1 });
    }

    // 2. Free area (stage insets) and the heart's silhouette on screen.
    const insets = viewer.stage === 'hidden' ? { left: 0, right: 0, top: 0, bottom: 0 } : ui.stageInsets;
    const free = freeArea(width, height, insets);
    const topRoom =
      ui.chrome === 'workstation' || ui.chrome === 'tour' ? CONTEXT_SLOT_ROOM : ui.chrome === 'focus' ? ANSWER_PILL_ROOM : 0;
    const bounds = { left: free.x, right: free.x + free.width, top: free.y + topRoom, bottom: free.y + free.height };
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of corners) {
      projected.copy(c).project(camera);
      const x = ((projected.x + 1) / 2) * width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    // The box corners sit a little outside the organ's silhouette; 95 % of the projected box hugs it.
    const cx = (minX + maxX) / 2;
    const half = ((maxX - minX) / 2) * SILHOUETTE;
    let heart = Number.isFinite(minX) && maxX > minX ? { minX: cx - half, maxX: cx + half } : null;
    const compact = width < 640;
    // While the heart opens, "the heart" is the union of both halves where they are NOW (the anterior half
    // swings toward viewer-left): labels go outside it, never on a half.
    const heartOpen = viewer.stage === 'workstation' ? sceneRuntime.peel.heartOpen : 0;
    const union = heartOpen > 0.02 ? halvesExtent(now) : null;
    if (union) heart = { minX: Math.min(heart?.minX ?? union.minX, union.minX), maxX: Math.max(heart?.maxX ?? union.maxX, union.maxX) };

    // 3. Lanes.
    const items: LaneItem[] = [];
    const screen = new Map<string, { x: number; y: number }>();
    for (const r of resolved) {
      projected.copy(r.anchor).project(camera);
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      screen.set(r.id, { x, y });
      const box = labelSizes.get(r.id) ?? { width: 72, height: 24 };
      items.push({ id: r.id, lane: resolveLane(r.id, viewer.carm?.azimuth, x, heart), x, y, width: box.width, height: box.height });
    }
    // Opened: one row below (or above) both halves; else the radiological lanes beside the heart.
    const row = union && heartOpen > 0.5 ? layoutRow(items, bounds, union) : null;
    const placed = row ?? layoutLanes(items, bounds, heart);
    // A switch between the row and the lanes (the heart opening or closing) glides every label to its new
    // slot (≤ LAYOUT_GLIDE_STEP px a frame) instead of jumping in one frame; otherwise labels track exactly.
    const layout = row ? 'row' : 'lanes';
    if (layout !== s.layout) {
      s.layout = layout;
      s.gliding = s.drawn.size > 0 && visible;
    }
    let arrived = true;
    for (const [id, at] of placed) {
      const drawn = s.drawn.get(id);
      if (!drawn || !s.gliding) s.drawn.set(id, { left: at.left, top: at.top, edgeX: at.edgeX, edgeY: at.edgeY });
      else if (!glideToward(drawn, at)) arrived = false;
    }
    if (s.gliding && arrived) s.gliding = false;

    // 4. States and DOM writes.
    const selected = viewer.selectedStructure;
    const cover = viewer.stage === 'workstation' ? coverFade(sceneRuntime.peel.e) : 1;
    resolved.forEach((r) => {
      const label = labelEls.get(r.id);
      const line = lineEls.get(r.id);
      const at = s.drawn.get(r.id) ?? placed.get(r.id);
      const anchor = screen.get(r.id);
      if (!label || !line || !at || !anchor) return;
      // The leader's far end never leaves the free area (a vessel point projected off-stage mid-flight would
      // otherwise draw a leader to the canvas edge).
      const p = {
        x: Math.min(bounds.right, Math.max(bounds.left, anchor.x)),
        y: Math.min(bounds.bottom, Math.max(free.y, anchor.y)),
      };
      const order = targets.indexOf(r.id);
      const revealed = visible && now - s.revealAt >= order * REVEAL_STAGGER_MS;
      const isSelected = selected === r.id;
      // Hovering its row (or the vessel) brings a dimmed label up to full strength: the hover link is visible.
      const hovered = viewer.hoveredStructure === r.id;
      const dimmed = selected !== null && !isSelected && !hovered;
      const behind = !isSelected && r.facing < 0;
      // Covered by the closed chest or hidden (isolate, ghosting): the label fades with its vessel.
      const seen = Math.min(cover, r.solid);
      // "(behind)" labels stay legible (≥ 75 %): the chip text keeps its contrast on the dark stage.
      const opacity = (!revealed ? 0 : isSelected || hovered ? 1 : dimmed ? 0.4 : behind ? 0.78 : 1) * seen;

      setStyle(label, 'transform', `translate3d(${at.left.toFixed(1)}px, ${at.top.toFixed(1)}px, 0)`);
      setStyle(label, 'opacity', fmt(opacity));
      setData(label, 'selected', String(isSelected));
      setData(label, 'dimmed', String(dimmed));
      setData(label, 'behind', String(behind));
      setData(label, 'compact', String(compact));
      setData(label, 'lane', items.find((i) => i.id === r.id)?.lane ?? 'right');

      setAttr(line, 'x1', at.edgeX.toFixed(1));
      setAttr(line, 'y1', at.edgeY.toFixed(1));
      setAttr(line, 'x2', p.x.toFixed(1));
      setAttr(line, 'y2', p.y.toFixed(1));
      setAttr(line, 'stroke-dasharray', dimmed || behind ? '3 3' : '');
      setAttr(line, 'data-selected', String(isSelected));
      setStyle(line, 'opacity', fmt((!revealed ? 0 : isSelected || hovered ? 0.9 : dimmed || behind ? 0.35 : 0.6) * seen));
      const dot = dotEls.get(r.id);
      if (dot) {
        setAttr(dot, 'cx', p.x.toFixed(1));
        setAttr(dot, 'cy', p.y.toFixed(1));
        setAttr(dot, 'data-selected', String(isSelected));
        setStyle(dot, 'opacity', fmt((!revealed || behind ? 0 : dimmed ? 0.5 : 1) * seen));
      }
    });

    // 5. Chamber tags at Open heart: at their anchor (a 5 px dot + "LV · mitral valve"), faded in over the end
    // of the opening, hidden when a wall stands in front of the anchor or while labels are off.
    const chamberAlpha = visible ? chamberFade(heartOpen) : 0;
    const anchors = chamberAlpha > 0 ? chamberAnchors(now) : [];
    for (const [id, el] of chamberEls) {
      const a = anchors.find((c) => c.id === id);
      const mesh = a ? nodeMesh(a.node, now) : null;
      if (!a || !mesh || chamberAlpha <= 0) {
        setStyle(el, 'opacity', '0');
        continue;
      }
      mesh.updateWorldMatrix(true, false);
      tmpPos.copy(a.local).applyMatrix4(mesh.matrixWorld);
      // Only a WALL in front hides a chamber (its own valve, chordae and papillary muscles are what it names).
      const hidden = isOccluded(eye, tmpPos, occludersFor(now).filter((o) => o.userData.ctKind === 'myocardium'));
      projected.copy(tmpPos).project(camera);
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      const inside = x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom;
      setStyle(el, 'transform', `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
      setStyle(el, 'opacity', fmt(hidden || !inside ? 0 : chamberAlpha));
    }

    // Hide labels whose vessel has no anchor (anatomy switched, target missing).
    for (const [id, label] of labelEls) {
      if (resolved.some((r) => r.id === id)) continue;
      setStyle(label, 'opacity', '0');
      const line = lineEls.get(id);
      if (line) setStyle(line, 'opacity', '0');
      const dot = dotEls.get(id);
      if (dot) setStyle(dot, 'opacity', '0');
    }
  });

  return null;
}
