import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, type Color, type IUniform, type Vector3 } from 'three';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { pendingColor } from '@/lib/riskColor';
import { riskLinear } from '@/theme/risk';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { readScene } from '../stage/sceneControls';

/** Damping rates λ (DESIGN_SYSTEM §6): p 6 (~450 ms), territory 4 (~600 ms), emissive / dim 8. */
const LAMBDA_P = 6;
const LAMBDA_TERRITORY = 4;
const LAMBDA_FAST = 8;
/** A request must stay pending this long before vessels fade toward the achromatic "updating" grey. */
const STALE_AFTER_S = 0.45;

/**
 * Vessel glow (§7.4, V2 §5.15): the emissive gain stays low until p ≈ 0.5 and climbs so the bloom
 * threshold (0.80, linear HDR) is crossed only around p ≈ 0.70 — high and very-high vessels glow, the rest
 * read by hue. Never on the myocardium.
 */
export const EMISSIVE = { floor: 0.3, gain: 2.1, onset: 0.5 } as const;
export const emissiveFor = (p: number, floorScale = 1) => {
  const t = Math.min(1, Math.max(0, (p - EMISSIVE.onset) / (1 - EMISSIVE.onset)));
  return EMISSIVE.floor * floorScale + EMISSIVE.gain * t * t * (3 - 2 * t);
};

/** Territory strength (V2 §5.15): selected mode 0.10 + 0.25·p, all mode 0.10 + 0.30·Σwp. */
export const TERRITORY_GAIN = { selected: 0.25, all: 0.3 } as const;

interface Anim {
  p: number;
  pending: number;
  dim: number;
  hover: number;
}

export interface VesselLike {
  color: Color;
  emissive: Color;
  emissiveIntensity: number;
  /** `userData.ct.floorScale`: Realistic vessels lower the emissive floor so their glossy shape reads. */
  userData?: Record<string, unknown>;
}

export interface TerritoryLike {
  uP: IUniform<Vector3>;
  uTerritoryOn: IUniform<number>;
  uSelMask: IUniform<Vector3>;
  uTerritoryGain?: IUniform<number>;
}

export interface RiskAnimationTargets {
  /** Vessel materials per target (may grow as looks / tiers are built; read every frame). */
  vessels: () => ReadonlyMap<string, readonly VesselLike[]>;
  /** Territory uniform sets (shared by the myocardium materials). */
  territories?: () => readonly TerritoryLike[];
}

/**
 * Drives risk colour on the 3D anatomy every frame WITHOUT React state (§7.4): the probability p is
 * damped and the ramp is sampled, so every intermediate frame sits on the legend ("animate p, not
 * colour"). Handles pending/stale (achromatic), selection dimming (desaturate 60 %, dim to 55 %), a 20 %
 * emissive lift on hover and the territory mode (off · selected · all). Requests another frame while
 * anything is still settling (demand mode).
 */
export function useRiskAnimation({ vessels, territories }: RiskAnimationTargets): void {
  const anim = useRef(new Map<string, Anim>());
  const territory = useRef({ on: 0, mask: [1, 1, 1], gain: TERRITORY_GAIN.selected as number });
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
    const scene = readScene();
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

    const selected = viewer.selectedStructure;
    for (const [target, materials] of vessels()) {
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
      a.dim = step(a.dim, selected && selected !== target && !scene.ghostOthers ? 1 : 0, LAMBDA_FAST);
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
      const lift = (1 - a.pending) * (1 + 0.2 * a.hover) * (1 - 0.6 * a.dim);
      for (const material of materials) {
        material.color.setRGB(r, g, b);
        material.emissive.setRGB(r, g, b);
        const floorScale = (material.userData?.ct as { floorScale?: number } | undefined)?.floorScale ?? 1;
        material.emissiveIntensity = emissiveFor(a.p, floorScale) * lift;
      }
    }

    const sets = territories?.() ?? [];
    if (sets.length > 0) {
      const pOf = (t: string) => anim.current.get(t)?.p ?? 0;
      const mode = scene.isolate && selected ? 'selected' : scene.territoryMode;
      const valid = !!prediction && patient.status !== 'error';
      const on = mode === 'off' || !valid ? 0 : mode === 'selected' ? (selected ? 1 : 0) : 1;
      const t = territory.current;
      t.on = step(t.on, on * (stale ? 0.4 : 1), LAMBDA_TERRITORY);
      const mask = (id: string) => (!selected ? 1 : selected === id ? 1 : mode === 'selected' ? 0 : 0.25);
      t.mask[0] = step(t.mask[0]!, mask('LAD'), LAMBDA_TERRITORY);
      t.mask[1] = step(t.mask[1]!, mask('LCX'), LAMBDA_TERRITORY);
      t.mask[2] = step(t.mask[2]!, mask('RCA'), LAMBDA_TERRITORY);
      t.gain = step(t.gain, mode === 'all' ? TERRITORY_GAIN.all : TERRITORY_GAIN.selected, LAMBDA_TERRITORY);
      for (const u of sets) {
        u.uP.value.set(pOf('LAD'), pOf('LCX'), pOf('RCA'));
        u.uTerritoryOn.value = t.on;
        u.uSelMask.value.set(t.mask[0]!, t.mask[1]!, t.mask[2]!);
        if (u.uTerritoryGain) u.uTerritoryGain.value = t.gain;
      }
    }

    if (settling) state.invalidate();
  });
}
