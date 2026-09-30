import { describe, expect, it } from 'vitest';
import type { ModalityRow } from './attribution';
import { leadSentence } from './modalityLead';

const row = (group: string, label: string, sum: number): ModalityRow =>
  ({ group, label, short: label, sum, abs: Math.abs(sum), share: 0, contributions: [] }) as unknown as ModalityRow;

describe('leadSentence', () => {
  it('names the lead modality with numbers a reader can add up from the columns', () => {
    const rows = [row('symptoms', 'Symptoms', 0.84), row('risk_factors', 'Risk factors', 0.61), row('labs', 'Labs', -0.2)];
    expect(leadSentence(rows, 'LAD', 'logodds', null)).toBe('Symptoms: +0.84 of the +1.45 log-odds raising LAD');
  });
  it('works for a lowering lead and says nothing when every column is zero', () => {
    const rows = [row('echo', 'Echo', -0.5), row('ecg', 'Resting ECG', 0.1)];
    expect(leadSentence(rows, 'CAD', 'logodds', null)).toBe('Echo: −0.50 of the −0.50 log-odds lowering CAD');
    expect(leadSentence([row('echo', 'Echo', 0)], 'CAD', 'logodds', null)).toBeNull();
  });
});
