import { AdaptiveDpr } from '@react-three/drei';
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
import { debugHandles } from './stage/debug';
import { usePickStore } from './stage/pickStore';
import { useSceneControls } from './stage/sceneControls';
import { probeWebGL } from './webgl';

const DPR: Record<RenderTier, number | [number, number]> = { A: [1, 1.5], B: [1, 1.25], C: 1, D: 1 };

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
        dpr={DPR[tier]}
        flat
        performance={{ min: 0.5 }}
        gl={{ antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' }}
        camera={{ fov: 30, near: 0.1, far: 50, position: [0, 0.3, 6] }}
        onCreated={({ gl, scene, camera }) => {
          gl.outputColorSpace = SRGBColorSpace;
          // The heart section plane is a per-material clipping plane (anatomy/rig.ts).
          gl.localClippingEnabled = true;
          if (debugHandles()) (window as unknown as { __ct?: unknown }).__ct = { gl, scene, camera, viewer: useViewerStore, controls: useSceneControls, pick: usePickStore };
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
        <QualityMonitor />
        <AdaptiveDpr />
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
