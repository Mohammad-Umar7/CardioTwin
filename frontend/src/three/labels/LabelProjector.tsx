import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import { useManifest, useSchemaIndex, useVessels } from '@/hooks/useData';
import { useUiStore, type Chrome } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { anchorsVersion, getAnchors } from '../anatomy/anchors';
import { BEAT_UNIFORMS } from '../anatomy/beatDeform';
import { BEATS_WITH_HEART, type TissueKind } from '../anatomy/classify';
import { useCameraState } from '../camera/cameraState';
import { collectOccluders, isOccluded } from '../camera/occlusion';
import { freeArea, heartBox } from '../camera/framing';
import { sceneRuntime } from '../stage/sceneRuntime';
import { buildTracks, restToDisplayed, type AnchorTrack } from './anchorTracks';
import { facing } from './dynamicAnchor';
import { dotEls, labelEls, labelSizes, layoutLanes, lineEls, resolveLane, type LaneItem } from './labelRegistry';

const DEFAULT_TARGETS = ['LAD', 'LCX', 'RCA'];
/** Labels fade in LAD → LCX → RCA, 60 ms apart, once the coronaries ignite (V2 §5.14). */
const REVEAL_STAGGER_MS = 60;
/** Room kept free above the lanes: the context slot (selection chip / what-if pill, 12 + 32) or, in focus
 * mode, the answer pill at the top right (12 + 40 + 8). */
const CONTEXT_SLOT_ROOM = 44;
const ANSWER_PILL_ROOM = 60;
/** Share of the heart box's projected width that the organ's silhouette actually covers. */
const SILHOUETTE = 0.95;
/** Anchor glide when the chosen candidate changes (per-second rate of an exponential approach). */
const ANCHOR_GLIDE = 14;

const projected = new Vector3();
const eye = new Vector3();
const tmpPos = new Vector3();
const tmpNormal = new Vector3();
const displayed = new Matrix4();

/** Writes a style / attribute only when it changed (the projector runs every frame). */
const cache = new WeakMap<Element, Record<string, string>>();
function put(el: Element, key: string, value: string, write: () => void) {
  let c = cache.get(el);
  if (!c) cache.set(el, (c = {}));
  if (c[key] === value) return;
  c[key] = value;
  write();
}
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
  const tracks = useMemo(() => buildTracks(manifest, vessels, targets), [manifest, vessels, targets]);
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
  });

  /** Occluders with a ready BVH, refreshed once a second (hidden layers drop out). */
  const occludersFor = (now: number): Mesh[] => {
    const s = state.current;
    if (now - s.occludersAt > 1000) {
      s.occluders = collectOccluders(scene);
      s.occludersAt = now;
    }
    return s.occluders;
  };

  const meshFor = (track: AnchorTrack, now: number): Object3D | null => {
    const s = state.current;
    const version = anchorsVersion();
    if (version !== s.meshVersion || (now - s.meshCheckedAt > 1000 && [...s.meshes.values()].some((m) => !m))) {
      s.meshVersion = version;
      s.meshCheckedAt = now;
      s.meshes.clear();
    }
    if (!s.meshes.has(track.node)) {
      let found: Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.name === track.node && typeof o.userData.ctKind === 'string' && !o.userData.ctGhost) found = o;
      });
      s.meshes.set(track.node, found);
    }
    return s.meshes.get(track.node) ?? null;
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
        restToDisplayed(mesh, track.centre, BEATS_WITH_HEART.has(kind) ? BEAT_UNIFORMS.uBeatMatrix.value : null, displayed);
        const pick = track.chooser.update(now, () => {
          // Facing the camera first; a facing point hidden behind an atrium or a great vessel ranks below
          // every unobstructed one (P0-2: the label points at something the viewer can see).
          const occluders = occludersFor(now);
          return track.candidates.map((c) => {
            tmpPos.copy(c.rest).applyMatrix4(displayed);
            tmpNormal.copy(c.normal).transformDirection(displayed);
            const f = facing(tmpPos, tmpNormal, eye);
            return f > 0 && isOccluded(eye, tmpPos, occluders) ? f - 1.5 : f;
          });
        });
        const c = track.candidates[Math.max(0, pick)]!;
        anchor = tmpPos.copy(c.rest).applyMatrix4(displayed).clone();
        face = facing(anchor, tmpNormal.copy(c.normal).transformDirection(displayed), eye);
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
      resolved.push({ id, anchor: s.shown.get(id)!, facing: face });
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
    const heart = Number.isFinite(minX) && maxX > minX ? { minX: cx - half, maxX: cx + half } : null;
    const compact = width < 640;

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
    const placed = layoutLanes(items, bounds, heart);

    // 4. States and DOM writes.
    const selected = viewer.selectedStructure;
    resolved.forEach((r) => {
      const label = labelEls.get(r.id);
      const line = lineEls.get(r.id);
      const at = placed.get(r.id);
      const p = screen.get(r.id);
      if (!label || !line || !at || !p) return;
      const order = targets.indexOf(r.id);
      const revealed = visible && now - s.revealAt >= order * REVEAL_STAGGER_MS;
      const isSelected = selected === r.id;
      const dimmed = selected !== null && !isSelected;
      const behind = !isSelected && r.facing < 0;
      const opacity = !revealed ? 0 : isSelected ? 1 : dimmed ? 0.4 : behind ? 0.55 : 1;

      setStyle(label, 'transform', `translate3d(${at.left.toFixed(1)}px, ${at.top.toFixed(1)}px, 0)`);
      setStyle(label, 'opacity', String(opacity));
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
      setStyle(line, 'opacity', !revealed ? '0' : isSelected ? '0.9' : dimmed || behind ? '0.35' : '0.6');
      const dot = dotEls.get(r.id);
      if (dot) {
        setAttr(dot, 'cx', p.x.toFixed(1));
        setAttr(dot, 'cy', p.y.toFixed(1));
        setAttr(dot, 'data-selected', String(isSelected));
        setStyle(dot, 'opacity', !revealed || behind ? '0' : dimmed ? '0.5' : '1');
      }
    });

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
