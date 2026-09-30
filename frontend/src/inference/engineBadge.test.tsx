/** EnginePill rendering (`features/shell/EngineBadge.tsx`) for the states the cross-check drives. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineBadge } from '@/features/shell/EngineBadge';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import { sampleHealth, samplePrediction } from '@/test/fixtures';
import type { ParityReport } from './parity';
import { useVerificationStore, type VerificationRecord } from './verification';

const report = (agree: boolean): ParityReport => ({
  agree,
  maxDeltaProbability: agree ? 2.2e-16 : 3.1e-4,
  maxDeltaLogit: 0,
  maxDeltaBase: 0,
  maxDeltaShap: agree ? 1.1e-15 : 0,
  targets: ['CAD', 'LAD', 'LCX', 'RCA'],
  contributions: 212,
  mismatches: agree ? [] : ['LAD.probability |Δ| 3.10e-4 > 1.00e-6'],
  boundaryTies: [],
});

const record = (key: string, agree: boolean): VerificationRecord => ({ key, agree, report: report(agree), edgeMs: 1, serverMs: 8, at: Date.now() });

beforeEach(() => {
  // The verifier starts on mount; keep it off the network.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  useEngineStore.setState({ engine: null, health: sampleHealth, reason: 'Server answered the health check' });
  usePatientStore.setState({
    selectedPatientId: 'P-017',
    mode: 'cohort',
    engineStatus: 'server',
    engineDescription: 'FastAPI server · model 1.1.0',
    status: 'ready',
    prediction: { ...samplePrediction, engine: 'server' },
    latencyMs: 8,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount() {
  const view = render(<EngineBadge />);
  const pill = screen.getByRole('button', { name: /Prediction engine/ });
  return { view, pill };
}

describe('EngineBadge', () => {
  it('shows Server ✓ and the cross-check summary in its tooltip', () => {
    const { pill } = mount();
    act(() => {
      useVerificationStore.setState({
        enabled: true,
        secondary: 'edge',
        total: 81,
        records: { 'P-017': record('P-017', true), 'P-003': record('P-003', true) },
      });
    });
    expect(pill).toHaveAttribute('data-engine-state', 'server');
    expect(pill).toHaveAccessibleName('Prediction engine: Server ✓');
    fireEvent.focus(pill);
    expect(screen.getByText(/Cross-check against the in-browser engine/)).toBeInTheDocument();
    expect(screen.getByText(/P-017: engines agree/)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 81/)).toBeInTheDocument();
  });

  it('turns to Engines disagree (with the failing field) when any check disagrees', () => {
    const { pill } = mount();
    act(() => {
      useVerificationStore.setState({ enabled: true, secondary: 'edge', total: 81, records: { 'P-017': record('P-017', false) } });
    });
    expect(pill).toHaveAttribute('data-engine-state', 'disagree');
    expect(pill).toHaveTextContent('Engines disagree');
    fireEvent.focus(pill);
    expect(screen.getByText(/P-017: engines disagree · LAD\.probability/)).toBeInTheDocument();
  });

  it('shows Verifying only once the on-screen check has run for 150 ms', () => {
    vi.useFakeTimers();
    try {
      const { pill } = mount();
      act(() => {
        useVerificationStore.setState({ enabled: true, secondary: 'edge', active: { key: 'P-017', since: performance.now() } });
      });
      expect(pill).toHaveAttribute('data-engine-state', 'server');
      act(() => {
        vi.advanceTimersByTime(160);
      });
      expect(pill).toHaveAttribute('data-engine-state', 'verifying');
      act(() => {
        useVerificationStore.setState({ active: null, records: { 'P-017': record('P-017', true) } });
      });
      expect(pill).toHaveAttribute('data-engine-state', 'server');
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels edge numbers with their latency and a ✓ once the server confirmed them', () => {
    usePatientStore.setState({ engineStatus: 'edge', prediction: { ...samplePrediction, engine: 'edge' }, latencyMs: 2.4 });
    const { pill } = mount();
    expect(pill).toHaveTextContent('Edge 2 ms');
    act(() => {
      useVerificationStore.setState({ enabled: true, secondary: 'server', records: { 'P-017': record('P-017', true) } });
    });
    expect(pill).toHaveTextContent('Edge 2 ms ✓');
  });

  it('makes a mid-session failover visible', () => {
    usePatientStore.setState({ prediction: { ...samplePrediction, engine: 'edge' } });
    const { pill } = mount();
    expect(pill).toHaveAttribute('data-engine-state', 'failover');
    expect(pill).toHaveTextContent('Edge · server offline');
  });
});
