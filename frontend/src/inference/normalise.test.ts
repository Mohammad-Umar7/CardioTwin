import { describe, expect, it } from 'vitest';
import { derivedValue } from './encode';
import { FeatureInputError } from './errors';
import { normaliseFeatures, normaliseValue, parsePythonFloat } from './normalise';
import type { PortableFeature, PortableModelSpec } from './types';

const binary: PortableFeature = { key: 'DM', type: 'binary', default: 0 };
const sex: PortableFeature = {
  key: 'Sex',
  type: 'categorical',
  default: 'Male',
  options: ['Male', 'Female'],
  aliases: { Fmale: 'Female' },
};
const age: PortableFeature = { key: 'Age', type: 'numeric', default: 57 };

describe('normaliseValue — binary', () => {
  it.each([
    [1, 1],
    [0, 0],
    [-0, 0],
    [true, 1],
    [false, 0],
    ['Y', 1],
    [' yes ', 1],
    ['TRUE', 1],
    ['t', 1],
    ['1', 1],
    ['n', 0],
    ['No', 0],
    ['false', 0],
    ['F', 0],
    ['0', 0],
  ] as const)('%j → %i', (input, expected) => {
    const out = normaliseValue(binary, input);
    expect(out).toBe(expected);
    expect(Object.is(out, -0)).toBe(false);
  });

  it.each([2, 0.5, 'maybe', '', null])('rejects %j', (input) => {
    expect(() => normaliseValue(binary, input as never)).toThrow(FeatureInputError);
  });
});

describe('normaliseValue — categorical', () => {
  it('matches options case-insensitively and applies dataset aliases', () => {
    expect(normaliseValue(sex, 'male')).toBe('Male');
    expect(normaliseValue(sex, ' FEMALE ')).toBe('Female');
    expect(normaliseValue(sex, 'fmale')).toBe('Female');
    expect(normaliseValue(sex, 'Fmale')).toBe('Female');
  });

  it('rejects non-strings and unknown options, naming the feature', () => {
    expect(() => normaliseValue(sex, 1)).toThrow(/Sex: expected one of/);
    expect(() => normaliseValue(sex, 'other')).toThrow(FeatureInputError);
    try {
      normaliseValue(sex, 'x');
    } catch (error) {
      expect((error as FeatureInputError).features).toEqual(['Sex']);
    }
  });
});

describe('normaliseValue — numeric (Python float() semantics)', () => {
  it.each([
    [63, 63],
    [12.25, 12.25],
    ['1_000', 1000],
    ['  12.5 ', 12.5],
    ['.5', 0.5],
    ['5.', 5],
    ['1e3', 1000],
    ['-2.5E-2', -0.025],
    ['+7', 7],
  ] as const)('%j → %d', (input, expected) => {
    expect(normaliseValue(age, input)).toBe(expected);
  });

  it.each(['', '0x10', '1__0', '_1', '1,5', 'abc', '1e', '.'])('rejects %j like Python', (input) => {
    expect(() => normaliseValue(age, input)).toThrow(/expected a number/);
  });

  it.each(['inf', '-Infinity', 'nan', Number.NaN, Number.POSITIVE_INFINITY])('rejects non-finite %j', (input) => {
    expect(() => normaliseValue(age, input)).toThrow(/must be finite/);
  });

  it('rejects booleans', () => {
    expect(() => normaliseValue(age, true)).toThrow(/got a boolean/);
  });

  it('parsePythonFloat mirrors float(str)', () => {
    expect(parsePythonFloat('1_2.3_4e1_0')).toBe(12.34e10);
    expect(parsePythonFloat('-inf')).toBe(-Infinity);
    expect(parsePythonFloat('NaN')).toBeNaN();
    expect(parsePythonFloat('1.2.3')).toBeNull();
  });
});

describe('normaliseFeatures', () => {
  const features = [age, sex, binary];

  it('imputes missing and null keys in feature order', () => {
    const { values, imputed } = normaliseFeatures(features, { DM: 'y', Age: null });
    expect(values).toEqual({ Age: 57, Sex: 'Male', DM: 1 });
    expect(imputed).toEqual(['Age', 'Sex']);
  });

  it('rejects unknown keys (including leakage columns) before anything else', () => {
    expect(() => normaliseFeatures(features, { Age: 50, LAD: 1, Cath: 'Cad' })).toThrow(/unknown feature\(s\)/);
    try {
      normaliseFeatures(features, { LAD: 1 });
    } catch (error) {
      expect((error as FeatureInputError).features).toEqual(['LAD']);
    }
  });

  it('ignores inherited properties', () => {
    const input = Object.create({ Age: 99 }) as Record<string, number>;
    expect(normaliseFeatures(features, input).imputed).toEqual(['Age', 'Sex', 'DM']);
  });
});

describe('derivedValue (reference values from portable.derived_value)', () => {
  const constants: PortableModelSpec['constants'] = { ratio_min_denominator: 0.001, ckd_epi_min_creatinine: 0.1 };
  const values = { TG: 150, HDL: 40, Z: 0, CR: 1.3, CRlow: 0.5, CRtiny: 0.01, Age: 63, F: 'Female', M: 'Male', a: 1.5, b: 2.25, c: -0.5 };
  const spec = (op: string, inputs: string[]) => ({ feature: 'd', column: 'd', op, inputs });

  it('ratio guards the denominator', () => {
    expect(derivedValue(spec('ratio', ['TG', 'HDL']), values, constants)).toBe(3.75);
    expect(derivedValue(spec('ratio', ['TG', 'Z']), values, constants)).toBe(150000.0);
  });

  it('sum adds in order', () => {
    expect(derivedValue(spec('sum', ['a', 'b', 'c']), values, constants)).toBe(3.25);
  });

  it('ckd_epi_2021 matches the reference to the last bits', () => {
    const cases: [string, string, number][] = [
      ['CR', 'F', 46.205215905486604],
      ['CR', 'M', 61.72823434775989],
      ['CRlow', 'F', 105.32276095653113],
      ['CRlow', 'M', 114.60858819874343],
      ['CRtiny', 'M', 186.340005526427],
    ];
    for (const [cr, sexKey, expected] of cases) {
      const got = derivedValue(spec('ckd_epi_2021', [cr, 'Age', sexKey]), values, constants);
      expect(Math.abs(got - expected)).toBeLessThanOrEqual(4 * Number.EPSILON * expected);
    }
  });

  it('rejects unknown ops', () => {
    expect(() => derivedValue(spec('product', ['a', 'b']), values, constants)).toThrow(/unknown derived op/);
  });
});
