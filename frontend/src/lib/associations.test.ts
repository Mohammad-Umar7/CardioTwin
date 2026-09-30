import { describe, expect, it } from 'vitest';
import schemaRaw from '../../public/model/schema.json?raw';
import { ASSOCIATION_LEGEND, ASSOCIATION_MARK, ASSOCIATION_ONLY, isAssociationOnly, namesAssociation } from './associations';

const keys = new Set((JSON.parse(schemaRaw) as { features: { key: string }[] }).features.map((f) => f.key));

describe('association-only inputs', () => {
  it('names real schema inputs only', () => {
    for (const k of ASSOCIATION_ONLY) expect(keys.has(k)).toBe(true);
  });

  it('marks ESR and electrolytes, never an established risk factor or ischaemia sign', () => {
    expect(isAssociationOnly('ESR')).toBe(true);
    expect(isAssociationOnly('Na')).toBe(true);
    for (const k of ['Typical Chest Pain', 'DM', 'HTN', 'DLP', 'Current Smoker', 'FH', 'Age', 'EF-TTE', 'Region RWMA', 'LDL', 'St Depression'])
      expect(isAssociationOnly(k)).toBe(false);
    expect(isAssociationOnly(undefined)).toBe(false);
  });

  it('flags a narrative that names a marked input, and the legend explains the mark', () => {
    expect(namesAssociation([{ kind: 'text', text: 'a normal ' }, { kind: 'phrase', text: 'ESR', feature: 'ESR' }])).toBe(true);
    expect(namesAssociation([{ kind: 'phrase', text: 'typical angina', feature: 'Typical Chest Pain' }])).toBe(false);
    expect(ASSOCIATION_LEGEND.startsWith(ASSOCIATION_MARK)).toBe(true);
  });
});
