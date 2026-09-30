/**
 * Feature-based patient descriptions for the switcher and the palette (WORKSTATION_V2 §5.2):
 * "61 y F · atypical angina · diabetic". Built only from model INPUTS, so a description can never
 * reveal the catheterisation result of a held-out TEST patient.
 */
import type { FeatureVector } from '@/types/contracts';
import { THIN_SPACE } from '@/lib/format';
import { isPresent, numericValue } from './values';

export interface Identity {
  /** "Male" | "Female" | null */
  sex: string | null;
  age: number | null;
}

export function identityOf(features: FeatureVector): Identity {
  const rawSex = features.Sex;
  const sex =
    typeof rawSex === 'string' && rawSex.trim()
      ? /^f/i.test(rawSex)
        ? 'Female'
        : /^m/i.test(rawSex)
          ? 'Male'
          : rawSex
      : null;
  const age = numericValue(features.Age);
  return { sex, age: Number.isFinite(age) ? Math.round(age) : null };
}

/** "Male · 58 y" (card header). */
export function identityLine({ sex, age }: Identity): string {
  return [sex, age !== null ? `${age} y` : null].filter(Boolean).join(' · ');
}

/** "58 y M" (compact, for list rows). */
export function compactIdentity({ sex, age }: Identity): string {
  return [age !== null ? `${age} y` : null, sex ? sex.charAt(0) : null].filter(Boolean).join(' ');
}

/** Presenting symptom, in priority order. */
export function chestPainPhrase(features: FeatureVector): string {
  if (isPresent(features['Typical Chest Pain'])) return 'typical angina';
  if (isPresent(features.Atypical)) return 'atypical angina';
  if (isPresent(features.Nonanginal)) return 'non-anginal pain';
  if (isPresent(features['LowTH Ang'])) return 'low-threshold angina';
  if (isPresent(features.Dyspnea)) return 'shortness of breath';
  return 'no chest pain';
}

/**
 * Up to `max` salient findings, most specific first: echo and ECG abnormalities, then risk factors.
 * ("EF 20 %", "wall-motion abnormality", "Q waves", "ST depression", "LBBB", "diabetic", …)
 */
export function salientFindings(features: FeatureVector, max = 2): string[] {
  const out: string[] = [];
  const ef = numericValue(features['EF-TTE']);
  if (Number.isFinite(ef) && ef < 40) out.push(`EF ${Math.round(ef)}${THIN_SPACE}%`);
  const rwma = numericValue(features['Region RWMA']);
  if (Number.isFinite(rwma) && rwma >= 2) out.push('wall-motion abnormality');
  if (isPresent(features['Q Wave'])) out.push('Q waves');
  if (isPresent(features['St Elevation'])) out.push('ST elevation');
  if (isPresent(features['St Depression'])) out.push('ST depression');
  const bbb = features.BBB;
  if (typeof bbb === 'string' && /bbb/i.test(bbb)) out.push(bbb.toUpperCase());
  if (isPresent(features.DM)) out.push('diabetic');
  if (isPresent(features.HTN)) out.push('hypertensive');
  if (isPresent(features.DLP)) out.push('dyslipidaemia');
  if (isPresent(features['Current Smoker'])) out.push('smoker');
  if (isPresent(features.FH)) out.push('family history');
  return out.slice(0, max);
}

/** "61 y F · atypical angina · diabetic" */
export function describeFeatures(features: FeatureVector, maxFindings = 2): string {
  const parts = [compactIdentity(identityOf(features)), chestPainPhrase(features), ...salientFindings(features, maxFindings)];
  return parts.filter(Boolean).join(' · ');
}
