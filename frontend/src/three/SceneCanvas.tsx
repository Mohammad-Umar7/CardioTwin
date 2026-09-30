import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { NeutralToneMapping, NoToneMapping, SRGBColorSpace } from 'three';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useViewerStore, type RenderTier } from '@/state/viewerStore';
import { Anatomy } from './anatomy/Anatomy';
import { CameraRig } from './camera/CameraRig';
import { handleCanvasKey } from './camera/controlsApi';
import { LabelProjector } from './labels/LabelProjector';
import { VesselLabelsOverlay } from './labels/VesselLabels';
import { SceneSummary } from './SceneSummary';
import { Background } from './stage/Background';
import { Lights, SceneEnvironment } from './stage/Lights';
import { SceneFX } from './fx/SceneFX';
import { QualityMonitor } from './stage/QualityMonitor';
import { dprFor, resolvedDpr } from './stage/dpr';
import { debugHandles } from './stage/debug';
import { usePickStore } from './stage/pickStore';
import { ensureRealisticDefault, useSceneControls } from './stage/sceneControls';
import { probeWebGL } from './webgl';

// Realistic is the default look (DESIGN_SYSTEM §7.9): switch the untouched store once, when the 3D stage
// module loads — never during a render.
ensureRealisticDefault();


/**
 * The tier's own pixel ratio, applied whenever the tier changes. Replaces drei's AdaptiveDpr, which scaled
 * the pixel ratio the canvas MOUNTED with and so overrode later tier changes (tier C ran at 1.25), and
 * which, with the camera's drag-time regress, resized the canvas and the post chain at every drag start and
 * end (a flicker frame each time). The adaptive tier is the one performance lever.
 */
function TierDpr({ tier, integrated }: { tier: RenderTier; integrated: boolean }) {
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    setDpr(resolvedDpr(dprFor(tier, integrated)));
  }, [tier, integrated, setDpr]);
  return null;
}

/** Tier C renders without the composer, so the renderer applies Khronos PBR Neutral itself (§7.1). */
function ToneMappingByTier({ tier }: { tier: RenderTier }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.toneMapping = tier === 'C' ? NeutralToneMapping : NoToneMapping;
    gl.toneMappingExposure = 1;
    invalidate();
  }, [gl, tier, invalidate]);
  return null;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * The single persistent WebGL canvas (DESIGN_SYSTEM §4, §7). Rendered by SceneHost into whichever page
 * slot is active; `active = false` (no slot) pauses rendering entirely.
 *
 * Render loop (§7.7): "always" only while something animates (heartbeat, landing turntable), the tab is
 * visible and a page shows the canvas; otherwise "demand" (frames on input or data change); "never" when
 * parked or hidden.
 */
export default function SceneCanvas({ active }: { active: boolean }) {
  const tier = useViewerStore((s) => s.tier);
  const stage = useViewerStore((s) => s.stage);
  const heartbeat = useViewerStore((s) => s.heartbeat);
  const setTier = useViewerStore((s) => s.setTier);
  const reduced = useReducedMotion();
  const visible = useDocumentVisible();
  const summaryId = useId();
  const [contextLosses, setContextLosses] = useState(0);

  useEffect(() => {
    if (contextLosses >= 2) setTier('D', true);
  }, [contextLosses, setTier]);

  useEffect(() => {
    // No half-float render targets → the composer cannot run: start (and stay) at C.
    if (!probeWebGL().halfFloat && !useViewerStore.getState().tierLocked) setTier('C', true);
  }, [setTier]);

  const animating = !reduced && (heartbeat || stage === 'hero');
  const frameloop = !active || !visible ? 'never' : animating ? 'always' : 'demand';

  // A click on empty space (not a drag) clears the selection (DESIGN_SYSTEM §7.5, V2 §8.2).
  const onPointerMissed = (e: MouseEvent) => {
    if (e.type !== 'click') return;
    const viewer = useViewerStore.getState();
    if (viewer.selectedStructure) viewer.select(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (handleCanvasKey(e.key)) e.preventDefault();
  };

  return (
    <div className="absolute inset-0">
      <Canvas
        frameloop={frameloop}
        dpr={dprFor(tier, probeWebGL().integrated)}
        flat
        performance={{ min: 0.5 }}
        // MSAA on the canvas: tier C renders without the post chain (no SMAA), so the hardware resolve is its
        // only anti-aliasing; at A/B the composer's final pass is a single full-screen triangle into it.
        gl={{ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' }}
        camera={{ fov: 30, near: 0.1, far: 50, position: [0, 0.3, 6] }}
        onCreated={({ gl, scene, camera, advance }) => {
          gl.outputColorSpace = SRGBColorSpace;
          // The heart section plane is a per-material clipping plane (anatomy/rig.ts).
          gl.localClippingEnabled = true;
          if (debugHandles()) {
            // `frames(n)` steps the whole frame loop (anatomy, camera, fx, composer) n times ~16 ms apart, so
            // a page whose rAF is throttled (hidden pane, background tab) can still be inspected.
            const frames = async (n = 1, ms = 16) => {
              for (let i = 0; i < n; i += 1) {
                advance(performance.now());
                await new Promise((r) => setTimeout(r, ms));
              }
            };
            (window as unknown as { __ct?: unknown }).__ct = { gl, scene, camera, viewer: useViewerStore, controls: useSceneControls, pick: usePickStore, frames };
          }
          gl.setClearColor('#06080A', 1);
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            setContextLosses((n) => n + 1);
          });
        }}
        role="application"
        aria-roledescription="3D heart viewer"
        aria-label="3D heart viewer. Drag to rotate, scroll to zoom, arrow keys orbit, plus and minus zoom."
        aria-describedby={summaryId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMissed={onPointerMissed}
        className="!absolute inset-0 outline-none"
        style={{ touchAction: 'none' }}
      >
        <ToneMappingByTier tier={tier} />
        <Background />
        <Lights />
        <SceneEnvironment />
        {/* Measure only a frame loop that really runs every frame (never on-demand frames). */}
        <QualityMonitor enabled={frameloop === 'always'} />
        <TierDpr tier={tier} integrated={probeWebGL().integrated} />
        <CameraRig />
        <Anatomy />
        <LabelProjector />
        <SceneFX /* fx layer: flow, pulse, ignition, atmosphere AND the post chain (was stage/PostFX) — fx/README.md */ />
      </Canvas>
      <VesselLabelsOverlay />
      <SceneSummary id={summaryId} />
    </div>
  );
}
