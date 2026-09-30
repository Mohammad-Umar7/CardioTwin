/** Top-bar PatientChip v2 (WORKSTATION_V2 §5.2). */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatientStore } from '@/state/patientStore';
import { PatientChip } from './PatientChip';
import { sexAgeLine } from './patientIdentity';

vi.mock('@/hooks/useData', () => ({
  useCohort: () => ({
    status: 'ready',
    data: { patients: [{ id: 'P-011', split: 'test', summary: '58 y · Male · typical angina · HTN', features: {}, labels: {} }] },
  }),
}));

vi.mock('@/features/patient/PatientSwitcher', () => ({
  PatientSwitcher: ({ onClose }: { onClose(): void }) => (
    <button type="button" onClick={onClose}>
      switcher content
    </button>
  ),
}));

describe('sexAgeLine', () => {
  it('reads sex and age from the cohort summary in the V2 order', () => {
    expect(sexAgeLine({ summary: '58 y · Male · typical angina · HTN' })).toBe('Male · 58 y');
    expect(sexAgeLine({ summary: '50 y · Female · no chest pain' })).toBe('Female · 50 y');
    expect(sexAgeLine({ summary: 'no demographics' })).toBeNull();
    expect(sexAgeLine(undefined)).toBeNull();
  });
});

describe('PatientChip', () => {
  beforeEach(() => {
    usePatientStore.setState({ selectedPatientId: 'P-011', split: 'test', mode: 'cohort', features: {}, recorded: {} });
  });

  it('shows the mono ID and one TEST tag, and opens the switcher popover', async () => {
    const user = userEvent.setup();
    render(<PatientChip />);
    const chip = screen.getByRole('button', { name: /Patient P-011\. Switch patient/ });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('TEST')).toHaveLength(1);
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Switch patient' })).toBeInTheDocument();
    await user.click(screen.getByText('switcher content'));
    expect(screen.queryByRole('dialog', { name: 'Switch patient' })).toBeNull();
  });

  it('reads "Blank patient" without a split tag for a blank patient', () => {
    usePatientStore.setState({ selectedPatientId: null, split: null, mode: 'blank' });
    render(<PatientChip />);
    expect(screen.getByRole('button', { name: /Patient Blank patient/ })).toBeInTheDocument();
    expect(screen.queryByText('TEST')).toBeNull();
  });
});
