import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { EffectPass, SMAAPreset, ToneMappingMode, type EffectComposer as EffectComposerImpl } from 'postprocessing';
import { useEffect, useRef } from 'react';
import { HalfFloatType } from 'three';
import type { RenderTier } from '@/state/viewerStore';

/**
 * Bloom settings per tier (DESIGN_SYSTEM §7.7). Bloom is selective *by construction*: the threshold
 * (0.80, on the linear HDR buffer, before tone mapping) sits above every non-emissive surface of the
 * clay rig, so only emissive vessels (≥ p ≈ 0.70), the flow particles and the pulse / ignition overlay
 * carry enough energy to glow. No second render of a selection layer is needed, which keeps the cost at
 * one mip chain (≤ 1.5 ms on Iris Xe at half resolution).
 */
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
 *   RenderPass → EffectPass(Bloom · ToneMapping NEUTRAL · Vignette) → EffectPass(SMAA MEDIUM, dithered)
 *
 * Bloom, tone mapping and vignette are not convolution effects, so postprocessing merges them into ONE
 * fullscreen pass; SMAA runs on the tone-mapped LDR image as it should. The last pass writes to the
 * screen with 8-bit ordered dithering so the dark vignette and bloom falloff never band.
 */
export function FXComposer({ tier }: { tier: RenderTier }) {
  const composer = useRef<EffectComposerImpl>(null);
  const gl = useThree((s) => s.gl);
  const levels = tier === 'A' ? BLOOM.levels.A : BLOOM.levels.B;

  // postprocessing's EffectComposer switches the renderer's autoClear OFF (it clears its own buffers) and
  // never switches it back. Dropping to tier C at runtime would then render R3F frames without clearing
  // colour/depth — stale depth rejects most of the anatomy and the heart goes black. Restore it on unmount.
  useEffect(
    () => () => {
      gl.autoClear = true;
    },
    [gl],
  );

  // Passes are (re)built by the composer's layout effect whenever children change; flag dithering on the
  // screen-facing pass as soon as it exists (a loop over ≤ 3 passes per frame, no allocation).
  useFrame(() => {
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
      <Bloom
        mipmapBlur
        luminanceThreshold={BLOOM.luminanceThreshold}
        luminanceSmoothing={BLOOM.luminanceSmoothing}
        intensity={BLOOM.intensity}
        radius={BLOOM.radius}
        levels={levels}
        resolutionScale={BLOOM.resolutionScale}
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.3} darkness={0.5} />
      <SMAA preset={SMAAPreset.MEDIUM} />
    </EffectComposer>
  );
}
