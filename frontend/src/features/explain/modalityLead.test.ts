import { describe, expect, it } from 'vitest';
import type { ModalityRow } from './attribution';
import { leadSentence } from './modalityLead';

const row = (group: string, label: string): ModalityRow =>
  ({ group, label, short: label, sum: 0, abs: 0, share: 0, contributions: [] }) as unknown as ModalityRow;

describe('leadSentence', () => {
  it('names the lead modality with net numbers a reader can add up from the columns', () => {
    const rows = [row('symptoms', 'Symptoms'), row('risk_factors', 'Risk factors'), row('labs', 'Labs')];
    expect(leadSentence(rows, [0.84, 0.61, -0.2], 'LAD', 'logodds')).toBe('Symptoms: +0.84 of the +1.45 net log-odds raising LAD');
    expect(leadSentence(rows, [-23, -11, 5], 'CAD', 'points')).toBe('Symptoms: −23 of the −34 net pts lowering CAD');
  });

  it('never says "X of the X" when the lead is the only modality on its side', () => {
    const rows = [row('echo', 'Echocardiography'), row('symptoms', 'Symptoms'), row('ecg', 'Resting ECG')];
    const s = leadSentence(rows, [53, -19, -2], 'LAD', 'points')!;
    expect(s).toBe('Echocardiography carries the whole net rise: +53 pts on LAD');
    expect(s).not.toMatch(/(\S+) of the \1/);
    expect(leadSentence([row('echo', 'Echo'), row('ecg', 'Resting ECG')], [-0.5, 0.1], 'CAD', 'logodds')).toBe(
      'Echo carries the whole net fall: −0.50 log-odds on CAD',
    );
  });

  it('says nothing when every column is zero', () => {
    expect(leadSentence([row('echo', 'Echo')], [0], 'CAD', 'logodds')).toBeNull();
  });
});
