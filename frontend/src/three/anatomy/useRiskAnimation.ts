import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, type MeshStandardMaterial } from 'three';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { pendingColor } from '@/lib/riskColor';
import { riskLinear } from '@/theme/risk';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import type { MyocardiumMaterial } from './materials';

/** Damping rates λ (DESIGN_SYSTEM §6): p 6 (~450 ms), territory 4 (~600 ms), emissive / dim 8. */
const LAMBDA_P = 6;
const LAMBDA_TERRITORY = 4;
const LAMBDA_FAST = 8;
/** A request must stay pending this long before vessels fade toward the achromatic "updating" grey. */
const STALE_AFTER_S = 0.45;

interface Anim {
  p: number;
  pending: number;
  dim: number;
  hover: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface RiskAnimationTargets {
  /** Materials per vessel target (one shared material per target). */
  vessels: ReadonlyMap<string, MeshStandardMaterial>;
  /** Myocardium materials carrying the territory tint (targets mapped to x/y/z = LAD/LCX/RCA). */
  myocardium?: readonly MyocardiumMaterial[];
}

/**
 * Drives risk colour on the 3D anatomy every frame WITHOUT React state (§7.4): the probability p is
 * damped and the ramp is sampled, so every intermediate frame sits on the legend ("animate p, not
 * colour"). Handles pending/stale (achromatic), selection dimming (desaturate 60 %, dim to 55 %) and a
 * 20 % emissive lift on hover. Requests another frame while anything is still settling (demand mode).
 */
export function useRiskAnimation({ vessels, myocardium = [] }: RiskAnimationTargets): void {
  const anim = useRef(new Map<string, Anim>());
  const territory = useRef({ on: 0 });
  const loadingSince = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const invalidate = useThree((s) => s.invalidate);

  // In on-demand render mode nothing redraws by itself: wake the loop whenever the inputs change.
  useEffect(() => {
    const unsubPatient = usePatientStore.subscribe(() => invalidate());
    const unsubViewer = useViewerStore.subscribe(() => invalidate());
    return () => {
      unsubPatient();
      unsubViewer();
    };
  }, [invalidate]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const patient = usePatientStore.getState();
    const viewer = useViewerStore.getState();
    const prediction = patient.prediction;
    const now = state.clock.elapsedTime;

    if (patient.status === 'loading') loadingSince.current ??= now;
    else loadingSince.current = null;
    const stale = loadingSince.current !== null && now - loadingSince.current > STALE_AFTER_S;

    let settling = false;
    const step = (from: number, to: number, lambda: number) => {
      const next = reduced ? to : MathUtils.damp(from, to, lambda, dt);
      if (Math.abs(next - to) > 1e-3) settling = true;
      return Math.abs(next - to) <= 1e-4 ? to : next;
    };

    for (const [target, material] of vessels) {
      const goal = prediction?.predictions[target]?.probability;
      const hasGoal = typeof goal === 'number';
      let a = anim.current.get(target);
      if (!a) {
        a = { p: hasGoal ? goal : 0, pending: hasGoal ? 0 : 1, dim: 0, hover: 0 };
        anim.current.set(target, a);
      }
      if (hasGoal) a.p = step(a.p, goal, LAMBDA_P);
      const unavailable = !hasGoal || (patient.status === 'error' && !prediction);
      a.pending = step(a.pending, unavailable ? 1 : stale ? 0.6 : 0, LAMBDA_FAST);
      const selected = viewer.selectedStructure;
      a.dim = step(a.dim, selected && selected !== target ? 1 : 0, LAMBDA_FAST);
      a.hover = step(a.hover, viewer.hoveredStructure === target ? 1 : 0, LAMBDA_FAST * 1.5);

      const [r0, g0, b0] = riskLinear(a.p);
      const [pr, pg, pb] = pendingColor.linear;
      let r = r0 + (pr - r0) * a.pending;
      let g = g0 + (pg - g0) * a.pending;
      let b = b0 + (pb - b0) * a.pending;
      // selection: desaturate 60 % and dim to 55 %, but stay opaque
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const desat = 0.6 * a.dim;
      const k = 1 - 0.45 * a.dim;
      r = (r + (lum - r) * desat) * k;
      g = (g + (lum - g) * desat) * k;
      b = (b + (lum - b) * desat) * k;
      material.color.setRGB(r, g, b);
      material.emissive.setRGB(r, g, b);
      const glow = 0.35 + 1.25 * smoothstep(0.4, 1.0, a.p);
      material.emissiveIntensity = glow * (1 - a.pending) * (1 + 0.2 * a.hover) * (1 - 0.6 * a.dim);
    }

    if (myocardium.length > 0) {
      const pOf = (t: string) => anim.current.get(t)?.p ?? 0;
      const on = viewer.territories && !!prediction && patient.status !== 'error' ? 1 : 0;
      territory.current.on = step(territory.current.on, on * (stale ? 0.4 : 1), LAMBDA_TERRITORY);
      const sel = viewer.selectedStructure;
      for (const m of myocardium) {
        const u = m.userData.uniforms;
        u.uP.value.set(pOf('LAD'), pOf('LCX'), pOf('RCA'));
        u.uTerritoryOn.value = territory.current.on;
        const mask = (t: string) => (!sel ? 1 : sel === t ? 1 : 0.25);
        u.uSelMask.value.set(
          step(u.uSelMask.value.x, mask('LAD'), LAMBDA_TERRITORY),
          step(u.uSelMask.value.y, mask('LCX'), LAMBDA_TERRITORY),
          step(u.uSelMask.value.z, mask('RCA'), LAMBDA_TERRITORY),
        );
      }
    }

    if (settling) state.invalidate();
  });
}
