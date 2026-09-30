import { describe, expect, it } from 'vitest';
import type { FeatureSchema } from '@/types/contracts';
import schemaRaw from '../../public/model/schema.json?raw';
import { withDisplayLabels } from './displayLabels';

describe('display-label overrides', () => {
  it('labels BMI > 25 as overweight, never as obesity', () => {
    const schema = JSON.parse(schemaRaw) as FeatureSchema;
    const out = withDisplayLabels(schema);
    expect(out.features.find((f) => f.key === 'Obesity')?.label).toBe('Overweight or obese (BMI > 25)');
    expect(out.features.filter((f) => /^Obesity/.test(f.label))).toEqual([]);
    // Everything else is untouched, and the input is not mutated.
    expect(out.features.length).toBe(schema.features.length);
    expect(schema.features.find((f) => f.key === 'Obesity')?.label).toBe('Obesity (BMI > 25)');
  });
});
