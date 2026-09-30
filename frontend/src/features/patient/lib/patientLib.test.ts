import { describe, expect, it } from 'vitest';
import cohortRaw from '../../../../public/model/cohort.json?raw';
import schemaRaw from '../../../../public/model/schema.json?raw';
import { indexSchema } from '@/hooks/useData';
import { THIN_SPACE } from '@/lib/format';
import { schemaDefaults } from '@/lib/patients';
import type { CohortResponse, Explanation, FeatureSchema } from '@/types/contracts';
import { CURATED_CASES } from '../curated';
import { aliasesFor, INPUT_ALIASES } from './aliases';
import { chestPainPhrase, describeFeatures, identityLine, identityOf } from './describe';
import { keyInputAriaLabel, rankKeyInputs, strengthOf } from './keyInputs';
import {
  buildProfile,
  decodeNumber,
  decodeShareState,
  encodeNumber,
  encodeShareState,
  parseProfile,
  profileFileName,
  schemaChecksum,
  shareUrl,
} from './profile';
import { computeSections, searchInputs } from './sections';
import { abnormality, displayValue, flipped, isPresent, rangeGlyph, snapNumeric } from './values';

const schema = JSON.parse(schemaRaw) as FeatureSchema;
const cohort = JSON.parse(cohortRaw) as CohortResponse;
const index = indexSchema(schema);
const defaults = schemaDefaults(schema);
const spec = (key: string) => index.byKey.get(key)!;
const p011 = cohort.patients.find((p) => p.id === 'P-011')!;

const explanation = (pairs: [string, number][]): Explanation => ({
  space: 'log-odds',
  base_value: 0,
  output_value: pairs.reduce((s, [, v]) => s + v, 0),
  contributions: pairs.map(([feature, shap]) => ({ feature, shap, value: null })),
});

describe('values', () => {
  it('reads findings in every dataset spelling', () => {
    expect([1, '1', 'Y', 'yes', true].every(isPresent)).toBe(true);
    expect([0, '0', 'N', 'no', false, undefined].some(isPresent)).toBe(false);
    expect(flipped(1)).toBe(0);
    expect(flipped('N')).toBe(1);
  });

  it('classifies abnormal values: range, present findings and non-normal categoricals', () => {
    expect(abnormality(spec('EF-TTE'), 40)).toBe('below');
    expect(abnormality(spec('FBS'), 101)).toBe('above');
    expect(abnormality(spec('FBS'), 90)).toBeNull();
    expect(abnormality(spec('HTN'), 1)).toBe('present');
    expect(abnormality(spec('HTN'), 0)).toBeNull();
    expect(abnormality(spec('BBB'), 'LBBB')).toBe('finding');
    expect(abnormality(spec('BBB'), 'N')).toBeNull();
    expect(abnormality(spec('Sex'), 'Female')).toBeNull();
    expect(abnormality(spec('Age'), 80)).toBeNull();
    expect(rangeGlyph(spec('EF-TTE'), 40)).toBe('▼');
  });

  it('snaps to the step from zero and clamps to the range', () => {
    expect(snapNumeric(spec('BMI'), 26.83)).toBe(26.8);
    expect(snapNumeric(spec('EF-TTE'), 47)).toBe(45);
    expect(snapNumeric(spec('Age'), 12)).toBe(30);
    expect(displayValue(spec('Age'), 58)).toBe(`58${THIN_SPACE}y`);
    expect(displayValue(spec('Typical Chest Pain'), 1)).toBe('Yes');
  });
});

describe('aliases', () => {
  it('covers every schema input with its raw key', () => {
    for (const f of schema.features) {
      expect(aliasesFor(f.key)[0]).toBe(f.key);
      expect(INPUT_ALIASES[f.key], f.key).toBeDefined();
    }
  });
});

describe('key inputs (patient card ranking)', () => {
  it('ranks by |SHAP|, excludes Age and Sex, and breaks ties by schema order', () => {
    const e = explanation([
      ['Age', 2],
      ['HTN', -0.5],
      ['Typical Chest Pain', 1.2],
      ['DM', 0.5],
      ['Sex', 1],
      ['EF-TTE', -0.3],
      ['FBS', 0.1],
      ['BP', 0.05],
    ]);
    const ranked = rankKeyInputs(index, e, { n: 5 });
    expect(ranked.map((r) => r.key)).toEqual(['Typical Chest Pain', 'DM', 'HTN', 'EF-TTE', 'FBS']);
    expect(ranked[0]).toMatchObject({ direction: 'raises', strength: 3 });
    expect(ranked[2]).toMatchObject({ direction: 'lowers' });
  });

  it('falls back to the key groups in schema order, without direction', () => {
    const ranked = rankKeyInputs(index, null, { n: 5 });
    expect(ranked.map((r) => r.spec.group)).toEqual(['symptoms', 'symptoms', 'symptoms', 'symptoms', 'symptoms']);
    expect(ranked.every((r) => r.direction === null && r.strength === null)).toBe(true);
  });

  it('describes a row for screen readers', () => {
    const [top] = rankKeyInputs(index, explanation([['Typical Chest Pain', 2]]));
    expect(keyInputAriaLabel(top!, 'yes', 'CAD')).toBe('Typical angina, yes, raises CAD risk strongly.');
    expect(strengthOf(0.01)).toBe(1);
  });
});

describe('drawer sections', () => {
  it('lists each input once above All inputs: changed, then outside normal, then most influential', () => {
    const features = { ...p011.features, 'Typical Chest Pain': 0, Age: 70 };
    const e = explanation([
      ['Typical Chest Pain', 1.3],
      ['HTN', 0.6],
      ['Region RWMA', -0.5],
      ['EF-TTE', -0.2],
      ['BP', 0.25],
    ]);
    const s = computeSections({ index, features, recorded: p011.features, explanation: e });
    expect(s.changed).toEqual(['Age', 'Typical Chest Pain']);
    expect(s.abnormal).toContain('HTN');
    expect(s.abnormal).toContain('FBS');
    expect(s.abnormal).not.toContain('Typical Chest Pain');
    expect(s.key).toEqual(expect.arrayContaining(['Region RWMA']));
    for (const k of s.key) expect([...s.changed, ...s.abnormal]).not.toContain(k);
  });

  it('finds inputs by label, alias and raw key, label matches first', () => {
    expect(searchInputs(index, 'ejection')[0]?.spec.key).toBe('EF-TTE');
    expect(searchInputs(index, 'EF')[0]?.spec.key).toBe('EF-TTE');
    expect(searchInputs(index, 'rwma')[0]?.spec.key).toBe('Region RWMA');
    expect(searchInputs(index, 'Typical Chest Pain')[0]?.spec.key).toBe('Typical Chest Pain');
    expect(searchInputs(index, 'sob')[0]?.spec.key).toBe('Dyspnea');
    expect(searchInputs(index, '   ')).toEqual([]);
    // a word match hides loose subsequence noise
    expect(searchInputs(index, 'EF').map((h) => h.spec.key)).not.toContain('LVH');
  });
});

describe('descriptions and curated cases', () => {
  it('describes a patient from inputs only', () => {
    expect(identityLine(identityOf(p011.features))).toBe('Male · 58 y');
    expect(describeFeatures(p011.features)).toBe('58 y M · typical angina · hypertensive');
    expect(chestPainPhrase({})).toBe('no chest pain');
  });

  it('curates 4–6 diverse held-out TEST patients and never mentions the cath result', () => {
    expect(CURATED_CASES.length).toBeGreaterThanOrEqual(4);
    expect(CURATED_CASES.length).toBeLessThanOrEqual(6);
    const patients = CURATED_CASES.map((c) => cohort.patients.find((p) => p.id === c.id));
    expect(patients.every((p) => p?.split === 'test')).toBe(true);
    expect(new Set(patients.map((p) => p!.features.Sex)).size).toBe(2);
    expect(new Set(patients.map((p) => chestPainPhrase(p!.features))).size).toBeGreaterThanOrEqual(3);
    const banned = /stenos|cath|positive|negative|diseased|healthy|missed|correct|wrong|surpris|label/i;
    for (const c of CURATED_CASES) expect(c.note).not.toMatch(banned);
    for (const p of patients) expect(describeFeatures(p!.features)).not.toMatch(banned);
  });
});

describe('patient profile JSON', () => {
  it('round-trips a cohort patient with edits', () => {
    const features = { ...p011.features, 'Typical Chest Pain': 0 };
    const profile = buildProfile({ index, patientId: 'P-011', split: 'test', recorded: p011.features, features, now: new Date('2026-09-30T10:00:00Z') });
    expect(profileFileName(profile)).toBe('cardiotwin-P-011-what-if-2026-09-30.json');
    const parsed = parseProfile(JSON.stringify(profile), index, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.patientId).toBe('P-011');
    expect(parsed.profile.features['Typical Chest Pain']).toBe(0);
    expect(parsed.profile.recorded['Typical Chest Pain']).toBe(1);
    expect(parsed.profile.warnings).toEqual([]);
  });

  it('accepts a flat map with labels, Yes/No findings and out-of-range numbers, and drops target columns', () => {
    const parsed = parseProfile(
      JSON.stringify({ age: 64, 'ejection fraction': 5, 'Typical angina': 'yes', Diabetes: 'N', BBB: 'lbbb', LAD: 1, Nonsense: 3 }),
      index,
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const f = parsed.profile.features;
    expect(f).toMatchObject({ Age: 64, 'EF-TTE': 15, 'Typical Chest Pain': 1, DM: 0, BBB: 'LBBB' });
    expect(f).not.toHaveProperty('LAD');
    expect(parsed.profile.recorded).toEqual(f);
    expect(parsed.profile.warnings.join(' ')).toMatch(/clamped/);
    expect(parsed.profile.warnings.join(' ')).toMatch(/unknown field/);
    expect(parsed.profile.warnings.join(' ')).toMatch(/Target columns/);
    expect(parsed.profile.warnings.join(' ')).toMatch(/cohort default/);
  });

  it('refuses files that are not JSON objects of inputs', () => {
    expect(parseProfile('{nope', index, defaults)).toMatchObject({ ok: false });
    expect(parseProfile('[1,2]', index, defaults)).toMatchObject({ ok: false });
    expect(parseProfile('{"a":1}', index, defaults)).toMatchObject({ ok: false });
  });
});

describe('share link codec', () => {
  it('packs numbers into URL-safe digits', () => {
    for (const n of [0, 70, 26.8, -3.5, 0.1, 7150]) expect(decodeNumber(encodeNumber(n))).toBeCloseTo(n, 9);
    expect(encodeNumber(26.8)).toBe('26p8');
    expect(Number.isNaN(decodeNumber('1e5'))).toBe(true);
  });

  it('round-trips the edits of a cohort patient compactly', () => {
    const features = { ...p011.features, 'Typical Chest Pain': 0, Age: 70, BBB: 'LBBB', BMI: 31.2 };
    const w = encodeShareState({ patientId: 'P-011', recorded: p011.features, features }, index, defaults);
    expect(w).toMatch(/^[0-9A-Za-z._-]+$/);
    expect(w.length).toBeLessThan(48);
    const decoded = decodeShareState(w, index);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.share).toEqual({
      patientId: 'P-011',
      recorded: {},
      edits: { 'Typical Chest Pain': 0, Age: 70, BBB: 'LBBB', BMI: 31.2 },
      skipped: 0,
    });
  });

  it('round-trips a blank patient with its own recorded values', () => {
    const recorded = { ...defaults, Age: 45, DM: 1 };
    const features = { ...recorded, 'EF-TTE': 35 };
    const decoded = decodeShareState(encodeShareState({ patientId: null, recorded, features }, index, defaults), index);
    expect(decoded).toMatchObject({ ok: true, share: { patientId: null, recorded: { Age: 45, DM: 1 }, edits: { 'EF-TTE': 35 } } });
  });

  it('refuses links from another model version and skips unreadable pairs', () => {
    const w = encodeShareState({ patientId: 'P-011', recorded: p011.features, features: { ...p011.features, Age: 70 } }, index, defaults);
    const other = indexSchema({ ...schema, features: schema.features.slice(1) });
    expect(decodeShareState(w, other)).toEqual({ ok: false, error: 'model' });
    expect(decodeShareState('garbage', index)).toEqual({ ok: false, error: 'format' });
    const tampered = `1_${schemaChecksum(index)}_P-011__0-999.zz-1.g-7`;
    expect(decodeShareState(tampered, index)).toMatchObject({ ok: true, share: { skipped: 3, edits: {} } });
  });

  it('builds the hash-route URL and keeps other query parameters', () => {
    const url = shareUrl('http://127.0.0.1:5173/app/#/workstation?t=LAD&w=old', 'P-011', '1_x_P-011__0-1');
    expect(url).toBe('http://127.0.0.1:5173/app/#/workstation/P-011?t=LAD&w=1_x_P-011__0-1');
  });
});
