import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import {
  BlendFunction,
  EffectPass,
  SMAAPreset,
  SelectiveBloomEffect,
  ToneMappingMode,
  type EffectComposer as EffectComposerImpl,
} from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import { HalfFloatType } from 'three';
import type { RenderTier } from '@/state/viewerStore';
import { BLOOM_LAYER, MASK_EPSILON, SCAN_EVERY, coronaryMeshes } from './bloomSelection';

/** Bloom settings per tier (DESIGN_SYSTEM §7.7). */
export const BLOOM = {
  luminanceThreshold: 0.8,
  luminanceSmoothing: 0.1,
  intensity: 0.55,
  radius: 0.6,
  resolutionScale: 0.5,
  levels: { A: 5, B: 4 } as Record<'A' | 'B', number>,
} as const;

/**
 * The post chain (DESIGN_SYSTEM §7.7), tiers A and B only — tier C renders without a composer and the
 * renderer applies Khronos PBR Neutral itself:
 *
 *   RenderPass → EffectPass(SelectiveBloom · ToneMapping NEUTRAL · Vignette) → EffectPass(SMAA MEDIUM, dithered)
 *
 * SELECTIVE bloom: only the coronary tree may glow — the vessels' emissive risk colour (visible from
 * p ≈ 0.70), and the flow streaks, pulse and ignition light that land on them. A depth-only pass of the
 * coronary meshes (layer BLOOM_LAYER) masks the bloom input, so glossy highlights on the myocardium, great
 * vessels or bone never bloom however bright they get. Cost: ~30 k triangles of depth plus one mask pass.
 * Bloom, tone mapping and vignette are not convolution effects, so they merge into ONE fullscreen pass;
 * SMAA runs on the tone-mapped image; the last pass is dithered so dark gradients never band.
 */
export function FXComposer({ tier }: { tier: RenderTier }) {
  const composer = useRef<EffectComposerImpl>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const levels = tier === 'A' ? BLOOM.levels.A : BLOOM.levels.B;
  const initialLevels = useRef(levels);

  const bloom = useMemo(() => {
    const effect = new SelectiveBloomEffect(scene, camera, {
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: BLOOM.luminanceThreshold,
      luminanceSmoothing: BLOOM.luminanceSmoothing,
      intensity: BLOOM.intensity,
      radius: BLOOM.radius,
      levels: initialLevels.current,
      resolutionScale: BLOOM.resolutionScale,
    });
    effect.selection.layer = BLOOM_LAYER;
    // `depthMaskMaterial` is public in postprocessing but missing from its typings.
    (effect as unknown as { depthMaskMaterial: { epsilon: number } }).depthMaskMaterial.epsilon = MASK_EPSILON;
    return effect;
  }, [scene, camera]);

  // A tier switch changes only the blur's mip chain, in place: re-creating the effect rebuilt the merged effect
  // pass and recompiled its program (a hitch on every A <-> B promotion).
  useEffect(() => {
    bloom.mipmapBlurPass.levels = levels;
  }, [bloom, levels]);

  const countdown = useRef(0);
  // Leave the anatomy's meshes as we found them (the selection toggles a layer bit on each) and free the
  // bloom targets when the chain goes away (tier C, unmount). Under StrictMode's development double-invoke
  // the effect is reused after this: three re-creates released GPU resources on next use and the next scan
  // re-selects the meshes.
  useEffect(
    () => () => {
      bloom.selection.clear();
      bloom.dispose();
      countdown.current = 0;
    },
    [bloom],
  );

  // postprocessing's EffectComposer switches the renderer's autoClear OFF (it clears its own buffers) and
  // never switches it back. Dropping to tier C at runtime would then render R3F frames without clearing
  // colour/depth — stale depth rejects most of the anatomy and the heart goes black. Restore it on unmount.
  useEffect(
    () => () => {
      gl.autoClear = true;
    },
    [gl],
  );

  // @react-three/postprocessing resizes the chain on CSS size changes only; a pixel-ratio change (a tier
  // switch) must resize its buffers too, or the scene keeps rendering at the old resolution.
  const dpr = useThree((s) => s.viewport.dpr);
  const size = useThree((s) => s.size);
  useEffect(() => {
    composer.current?.setSize(size.width, size.height);
  }, [dpr, size]);

  useFrame(() => {
    // Keep the bloom selection in sync with the (re)loaded anatomy: GLB, procedural placeholder, remounts.
    if (countdown.current-- <= 0) {
      countdown.current = SCAN_EVERY;
      const meshes = coronaryMeshes(scene);
      const same = meshes.length === bloom.selection.size && meshes.every((m) => bloom.selection.has(m));
      if (!same) bloom.selection.set(meshes);
    }
    // Passes are (re)built by the composer's layout effect whenever children change; flag dithering on
    // the screen-facing pass as soon as it exists (a loop over ≤ 3 passes per frame, no allocation).
    const passes = composer.current?.passes;
    if (!passes) return;
    for (let i = passes.length - 1; i >= 0; i -= 1) {
      const pass = passes[i];
      if (pass instanceof EffectPass) {
        if (!pass.dithering) pass.dithering = true;
        break;
      }
    }
  });

  return (
    <EffectComposer ref={composer} multisampling={0} frameBufferType={HalfFloatType} enableNormalPass={false}>
      {/* no `dispose` prop: on a primitive R3F would assign it onto the effect (bloom.dispose = null) */}
      <primitive object={bloom} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.3} darkness={0.5} />
      <SMAA preset={SMAAPreset.MEDIUM} />
    </EffectComposer>
  );
}
