import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeEngine, type PredictionEngine } from '@/services/engine';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import { sampleHealth } from '@/test/fixtures';
import type { CohortPatient, FeatureVector, PredictResponse } from '@/types/contracts';
import { InferenceClient } from './client';
import { deriveEnginePill, formatDelta, type EnginePillInput } from './enginePill';
import { EdgeModel } from './model';
import { loadCohort, loadModelSpec } from './testing/artifacts';
import { EngineVerifier, summarizeVerification, useVerificationStore } from './verification';

let model: EdgeModel;
let patients: CohortPatient[];
const clients: InferenceClient[] = [];
const verifiers: EngineVerifier[] = [];

beforeAll(() => {
  model = new EdgeModel(loadModelSpec());
  patients = loadCohort().patients.slice(0, 6);
});

beforeEach(() => {
  useEngineStore.setState({ engine: null, health: null, reason: '' });
  usePatientStore.setState({ selectedPatientId: null, mode: 'cohort', recorded: {}, features: {} });
});

afterEach(() => {
  for (const v of verifiers.splice(0)) v.release();
  for (const c of clients.splice(0)) c.dispose();
});

const edgeEngine = (): EdgeEngine => {
  const client = new InferenceClient({ source: { spec: loadModelSpec() } });
  clients.push(client);
  return new EdgeEngine({ client });
};

/** A stand-in server that answers with the reference model, optionally corrupting one patient. */
function fakeServer(corrupt?: { features: FeatureVector; delta: number }): PredictionEngine & { predict: ReturnType<typeof vi.fn> } {
  return {
    kind: 'server',
    available: true,
    description: 'fake server',
    predict: vi.fn(async (features: FeatureVector): Promise<PredictResponse> => {
      const r = structuredClone(model.predict(features)) as unknown as PredictResponse;
      r.engine = 'server';
      if (corrupt && JSON.stringify(features) === JSON.stringify(corrupt.features)) {
        r.predictions.LAD!.probability += corrupt.delta;
      }
      return r;
    }),
  };
}

function verifier(options: ConstructorParameters<typeof EngineVerifier>[0] = {}): EngineVerifier {
  const v = new EngineVerifier({
    sweepGapMs: 0,
    createEdge: edgeEngine,
    loadCohort: async () => ({ patients }),
    notify: () => undefined,
    ...options,
  });
  verifiers.push(v);
  v.retain();
  return v;
}

const until = async (predicate: () => boolean, timeoutMs = 4000) => {
  const t0 = Date.now();
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('EngineVerifier', () => {
  it('server on screen: checks the current patient first, then sweeps the cohort — all agree', async () => {
    const server = fakeServer();
    usePatientStore.setState({ selectedPatientId: patients[3]!.id, recorded: patients[3]!.features });
    verifier();
    useEngineStore.getState().setEngine(server, sampleHealth, 'test');
    await until(() => Object.keys(useVerificationStore.getState().records).length === patients.length);
    const state = useVerificationStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.secondary).toBe('edge');
    expect(state.total).toBe(patients.length);
    // The patient on screen was the first one checked.
    const first = Object.values(state.records).sort((a, b) => a.at - b.at)[0]!;
    expect(first.key).toBe(patients[3]!.id);
    const summary = summarizeVerification(state.records);
    expect(summary.agreeing).toBe(patients.length);
    expect(summary.maxDeltaProbability).toBe(0);
    expect(server.predict).toHaveBeenCalledTimes(patients.length);
  });

  it('flags a disagreement beyond tolerance and warns once', async () => {
    const notify = vi.fn();
    const bad = patients[1]!;
    verifier({ notify });
    useEngineStore.getState().setEngine(fakeServer({ features: bad.features, delta: 1e-3 }), sampleHealth, 'test');
    await until(() => Object.keys(useVerificationStore.getState().records).length === patients.length);
    const record = useVerificationStore.getState().records[bad.id]!;
    expect(record.agree).toBe(false);
    expect(record.report.mismatches[0]).toMatch(/^LAD\.probability/);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatch(new RegExp(`Engines disagree for ${bad.id}`));
    expect(summarizeVerification(useVerificationStore.getState().records).disagreeing).toHaveLength(1);
  });

  it('a patient selected later jumps the queue', async () => {
    const server = fakeServer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = { ...server, predict: vi.fn(async (f: FeatureVector) => (await gate, server.predict(f))) };
    verifier();
    useEngineStore.getState().setEngine(slow, sampleHealth, 'test');
    await until(() => useVerificationStore.getState().active !== null);
    usePatientStore.setState({ selectedPatientId: patients[5]!.id, recorded: patients[5]!.features });
    release();
    await until(() => Object.keys(useVerificationStore.getState().records).length >= 2);
    const order = Object.values(useVerificationStore.getState().records)
      .sort((a, b) => a.at - b.at)
      .map((r) => r.key);
    expect(order[1]).toBe(patients[5]!.id);
  });

  it('edge on screen with a healthy server: cross-checks against the server', async () => {
    const server = fakeServer();
    const edge = edgeEngine();
    await edge.ready();
    verifier({ createServer: () => server });
    useEngineStore.getState().setEngine(edge, sampleHealth, 'forced');
    await until(() => Object.keys(useVerificationStore.getState().records).length === patients.length);
    expect(useVerificationStore.getState().secondary).toBe('server');
  });

  it('edge on screen and no server: explains why nothing is checked', async () => {
    const edge = edgeEngine();
    await edge.ready();
    verifier();
    useEngineStore.getState().setEngine(edge, null, 'offline');
    await until(() => useVerificationStore.getState().reason.includes('offline'));
    expect(useVerificationStore.getState().enabled).toBe(false);
    expect(useVerificationStore.getState().records).toEqual({});
  });

  it('never compares an edge answer with itself when the server failed over', async () => {
    const failedOver: PredictionEngine = {
      kind: 'server',
      available: true,
      description: 'failed over',
      predict: async (f) => model.predict(f), // engine: "edge"
    };
    verifier({ maxConsecutiveFailures: 2 });
    useEngineStore.getState().setEngine(failedOver, sampleHealth, 'test');
    await until(() => useVerificationStore.getState().lastError !== null);
    await new Promise((r) => setTimeout(r, 30));
    expect(useVerificationStore.getState().records).toEqual({});
    expect(useVerificationStore.getState().lastError).toMatch(/did not answer this check itself/);
  });
});

describe('deriveEnginePill', () => {
  const base: EnginePillInput = {
    engineStatus: 'server',
    predictionStatus: 'ready',
    predictionEngine: 'server',
    latencyMs: 12,
    serverHealthy: true,
    verifying: false,
    disagreement: false,
    currentVerified: true,
  };

  it.each<[Partial<EnginePillInput>, string, string]>([
    [{ engineStatus: 'resolving' }, 'connecting', 'Connecting…'],
    [{ predictionStatus: 'error' }, 'error', 'Error'],
    [{ disagreement: true }, 'disagree', 'Engines disagree'],
    [{ verifying: true }, 'verifying', 'Verifying'],
    [{}, 'server', 'Server ✓'],
    [{ predictionEngine: 'edge' }, 'failover', 'Edge · server offline'],
    [{ serverHealthy: false }, 'offline', 'Server offline'],
    [{ engineStatus: 'edge', predictionEngine: 'edge', latencyMs: 2.6, currentVerified: false }, 'edge', 'Edge 3 ms'],
    [{ engineStatus: 'edge', predictionEngine: 'edge', latencyMs: 0.2 }, 'edge', 'Edge 1 ms ✓'],
    [{ engineStatus: 'unavailable', predictionStatus: 'error' }, 'offline', 'Server offline'],
  ])('%j → %s', (patch, kind, text) => {
    const pill = deriveEnginePill({ ...base, ...patch });
    expect(pill.kind).toBe(kind);
    expect(pill.text).toBe(text);
  });

  it('formats deltas compactly', () => {
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(2.22e-16)).toBe('2.2 × 10⁻¹⁶');
    expect(formatDelta(3.1e-4)).toBe('3.1 × 10⁻⁴');
  });
});
