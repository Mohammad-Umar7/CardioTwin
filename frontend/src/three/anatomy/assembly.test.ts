import { describe, expect, it } from 'vitest';
import {
  ASSEMBLY_DURATION,
  ASSEMBLY_IGNITE_AT,
  ASSEMBLY_STAGES,
  AssemblyClock,
  SKIP_FINISH_S,
  settle,
  stageById,
  stagePose,
} from './assembly';
import { assemblyStageOf, beatModeOf, classifyNode } from './classify';
import { BEAT_MODE } from './beatDeform';

describe('cold-load assembly choreography', () => {
  it('flies layers in outside-in: skin → muscle → ribs → lungs → great vessels → heart halves close', () => {
    const order = ['skin', 'muscle', 'skeleton', 'lungs', 'greatVessels', 'heartPosterior', 'heartAnterior'] as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(stageById(order[i]!).start).toBeGreaterThan(stageById(order[i - 1]!).start);
    }
  });

  it('lasts about 2.4 s and ignites the coronaries once the heart has closed', () => {
    expect(ASSEMBLY_DURATION).toBeGreaterThan(2);
    expect(ASSEMBLY_DURATION).toBeLessThanOrEqual(2.5);
    const anterior = stageById('heartAnterior');
    expect(ASSEMBLY_IGNITE_AT).toBeGreaterThan(anterior.start + 0.6 * anterior.duration);
    expect(ASSEMBLY_IGNITE_AT).toBeLessThanOrEqual(ASSEMBLY_DURATION);
  });

  it('moves every stage from fully out to rest monotonically, landing without overshoot', () => {
    for (const stage of ASSEMBLY_STAGES) {
      expect(stagePose(stage, stage.start - 0.1)).toEqual({ offset: stage.distance, reveal: 0 });
      expect(stagePose(stage, stage.start + stage.duration)).toEqual({ offset: 0, reveal: 1 });
      let prev = Infinity;
      for (let t = stage.start; t <= stage.start + stage.duration; t += 0.01) {
        const { offset, reveal } = stagePose(stage, t);
        expect(offset).toBeLessThanOrEqual(prev + 1e-12);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(reveal).toBeGreaterThanOrEqual(0);
        expect(reveal).toBeLessThanOrEqual(1);
        prev = offset;
      }
    }
  });

  it('uses a settle curve that starts and lands with zero slope', () => {
    expect(settle(0)).toBeCloseTo(1, 12);
    expect(settle(1)).toBeCloseTo(0, 12);
    expect(Math.abs(settle(1e-4) - 1)).toBeLessThan(1e-4);
    expect(Math.abs(settle(1 - 1e-3))).toBeLessThan(1e-3);
  });

  it('can be skipped by any input and then finishes within the skip window', () => {
    const clock = new AssemblyClock();
    clock.tick(0.5);
    expect(clock.done).toBe(false);
    clock.skip();
    let elapsed = 0;
    while (!clock.done && elapsed < 1) {
      clock.tick(1 / 60);
      elapsed += 1 / 60;
    }
    expect(clock.done).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(SKIP_FINISH_S + 1 / 60 + 1e-9);
  });

  it('starts finished under reduced motion or on a repeat visit', () => {
    expect(new AssemblyClock(true).done).toBe(true);
    expect(new AssemblyClock(true).progress).toBe(1);
  });
});

describe('node classification', () => {
  it('maps every GLB node of CONTRACTS §6.2 to a tissue kind', () => {
    expect(classifyNode('Heart_Wall_Anterior')).toBe('myocardium');
    expect(classifyNode('Coronary_LM')).toBe('leftMain');
    expect(classifyNode('Coronary_RCA_PDA')).toBe('coronary');
    expect(classifyNode('GreatVessel_PulmonaryArtery')).toBe('pulmonaryArtery');
    expect(classifyNode('GreatVessel_SVC')).toBe('systemicVein');
    expect(classifyNode('CostalCartilage')).toBe('cartilage');
    expect(classifyNode('Ribs_L')).toBe('bone');
    expect(classifyNode('Trachea_Bronchi')).toBe('airway');
    expect(classifyNode('Mystery', 'Layer_Skeleton')).toBe('bone');
    expect(classifyNode('Mystery')).toBe('other');
  });

  it('beats the heart and its riders through node matrices and blends the great-vessel roots', () => {
    expect(beatModeOf('myocardium')).toBe(BEAT_MODE.atrial);
    expect(beatModeOf('coronary')).toBe(BEAT_MODE.atrial);
    expect(beatModeOf('aorta')).toBe(BEAT_MODE.root);
    expect(beatModeOf('bone')).toBe(BEAT_MODE.none);
  });

  it('assigns the halves of the heart to their own assembly beats', () => {
    expect(assemblyStageOf('myocardium', 'Heart_Wall_Anterior')).toBe('heartAnterior');
    expect(assemblyStageOf('myocardium', 'Heart_Wall_Posterior')).toBe('heartPosterior');
    expect(assemblyStageOf('aorta', 'GreatVessel_Aorta')).toBe('greatVessels');
  });
});
