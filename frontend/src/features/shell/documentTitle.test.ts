/** Status in the tab (WORKSTATION_V2 §7). */
import { describe, expect, it } from 'vitest';
import { documentTitle, LANDING_TITLE, type TitleInput } from './documentTitle';

const base: TitleInput = {
  pathname: '/workstation/P-011',
  patient: 'P-011',
  cad: { probability: 0.981, band: 'critical' },
  updating: false,
  comparing: false,
  edits: 0,
};

describe('documentTitle', () => {
  it('reads the patient, the CAD estimate and its band word', () => {
    expect(documentTitle(base)).toBe('P-011 · CAD ≥95 % Very high — CardioTwin');
  });

  it('marks what-if edits, but not while holding to compare (the recorded estimate is shown)', () => {
    expect(documentTitle({ ...base, edits: 2, cad: { probability: 0.91, band: 'critical' } })).toBe(
      'P-011 (what-if) · CAD 91 % Very high — CardioTwin',
    );
    expect(documentTitle({ ...base, edits: 2, comparing: true })).toBe('P-011 · CAD ≥95 % Very high — CardioTwin');
  });

  it('never shows a stale estimate as current, and omits a missing one', () => {
    expect(documentTitle({ ...base, updating: true })).toBe('P-011 · updating — CardioTwin');
    expect(documentTitle({ ...base, cad: null })).toBe('P-011 — CardioTwin');
  });

  it('uses <1 % / >99 % and the page name off the workstation', () => {
    expect(documentTitle({ ...base, cad: { probability: 0.004, band: 'low' } })).toBe('P-011 · CAD ≤5 % Low — CardioTwin');
    expect(documentTitle({ ...base, pathname: '/performance' })).toBe('Model performance — CardioTwin');
    expect(documentTitle({ ...base, pathname: '/methodology' })).toBe('Methodology — CardioTwin');
    expect(documentTitle({ ...base, pathname: '/' })).toBe(LANDING_TITLE);
    expect(documentTitle({ ...base, patient: null })).toBe('Workstation — CardioTwin');
    // The report names its own tab (and so the saved PDF).
    expect(documentTitle({ ...base, pathname: '/report' })).toBeNull();
  });
});
