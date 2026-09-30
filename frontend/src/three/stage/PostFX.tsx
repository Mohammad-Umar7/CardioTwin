import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { HalfFloatType } from 'three';
import type { RenderTier } from '@/state/viewerStore';

/**
 * Post-processing (DESIGN_SYSTEM §7.7), tiers A and B only: Bloom (mipmap blur, threshold 0.80) →
 * Khronos PBR Neutral tone mapping (applied exactly once) → vignette → SMAA. Everything else (SSAO, DOF,
 * SSR, chromatic aberration, grain…) is banned by the spec.
 */
export function PostFX({ tier }: { tier: RenderTier }) {
  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        luminanceThreshold={0.8}
        luminanceSmoothing={0.1}
        intensity={0.55}
        radius={0.6}
        levels={tier === 'A' ? 5 : 4}
        resolutionScale={0.5}
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.3} darkness={0.5} />
      <SMAA />
    </EffectComposer>
  );
}
