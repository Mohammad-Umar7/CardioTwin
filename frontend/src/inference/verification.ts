/**
 * Engine cross-check behind the EnginePill ("Verifying" / "Server ✓" / "Engines disagree").
 *
 * When both engines exist (server healthy AND the portable model loaded), one prediction per patient
 * is computed by BOTH engines on identical inputs and compared field by field with the contract
 * tolerances (|Δp| < 1e-6, |Δshap| < 1e-5, same labels and bands except explained boundary ties —
 * `parity.compareResponses`):
 *   1. the patient on screen first, as soon as it is selected;
 *   2. then, in the background and paced, every other cohort patient (so the tooltip can say
 *      "81 / 81 patients agree"). Paused while the tab is hidden.
 * The server's numbers stay on screen; a disagreement raises one warning toast and the pill turns to
 * "Engines disagree". Nothing here ever changes a displayed prediction.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '@/services/api';
import {
  ServerEngine,
  createEdgeEngine,
  sanitizeFeatures,
  whenEngineReady,
  type PredictionEngine,
} from '@/services/engine';
import { cohortResource } from '@/services/staticData';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import type { EngineKind, FeatureVector, HealthResponse, PredictResponse } from '@/types/contracts';
import { VERIFYING_DELAY_MS } from './enginePill';
import { compareResponses, type ParityReport } from './parity';

export interface VerificationRecord {
  /** Patient id. */
  key: string;
  agree: boolean;
  report: ParityReport;
  /** Wall-clock latency of each engine for this check, ms. */
  edgeMs: number;
  serverMs: number;
  at: number;
}

export interface VerificationState {
  /** True while both engines are available and checks can run. */
  enabled: boolean;
  /** Why checks are (not) running, for the tooltip. */
  reason: string;
  /** The engine checked against the one on screen. */
  secondary: EngineKind | null;
  records: Record<string, VerificationRecord>;
  /** Check in flight (patient id, `performance.now()` at start). */
  active: { key: string; since: number } | null;
  /** Number of cohort patients the sweep will cover. */
  total: number;
  lastError: string | null;
}

const INITIAL: VerificationState = {
  enabled: false,
  reason: 'Waiting for the prediction engines…',
  secondary: null,
  records: {},
  active: null,
  total: 0,
  lastError: null,
};

export const useVerificationStore = create<VerificationState>()(() => ({ ...INITIAL }));

export interface VerificationSummary {
  checked: number;
  agreeing: number;
  disagreeing: VerificationRecord[];
  maxDeltaProbability: number;
  maxDeltaShap: number;
  meanEdgeMs: number | null;
}

export function summarizeVerification(records: Record<string, VerificationRecord>): VerificationSummary {
  const all = Object.values(records);
  let maxDeltaProbability = 0;
  let maxDeltaShap = 0;
  let edgeTotal = 0;
  for (const r of all) {
    maxDeltaProbability = Math.max(maxDeltaProbability, r.report.maxDeltaProbability);
    maxDeltaShap = Math.max(maxDeltaShap, r.report.maxDeltaShap);
    edgeTotal += r.edgeMs;
  }
  const disagreeing = all.filter((r) => !r.agree);
  return {
    checked: all.length,
    agreeing: all.length - disagreeing.length,
    disagreeing,
    maxDeltaProbability,
    maxDeltaShap,
    meanEdgeMs: all.length > 0 ? edgeTotal / all.length : null,
  };
}

export interface VerifierOptions {
  /** Pause between background checks, ms. */
  sweepGapMs?: number;
  /** Give up the sweep after this many consecutive failed checks (resumes on the next change). */
  maxConsecutiveFailures?: number;
  /** Factories, injectable for tests. */
  createEdge?: () => PredictionEngine;
  createServer?: (health: HealthResponse) => PredictionEngine;
  loadCohort?: () => Promise<{ patients: { id: string; features: FeatureVector }[] }>;
  notify?: (message: string) => void;
}

const timed = async <T>(work: Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const value = await work;
  return [value, performance.now() - t0];
};

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Ref-counted background worker; `retain()` from every mounted EnginePill, `release()` on unmount. */
export class EngineVerifier {
  private readonly options: Required<VerifierOptions>;
  private refs = 0;
  private unsubscribe: (() => void)[] = [];
  private primary: PredictionEngine | null = null;
  private secondary: PredictionEngine | null = null;
  private generation = 0;
  private readonly features = new Map<string, FeatureVector>();
  private queue: string[] = [];
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private failures = 0;
  private warned = false;

  constructor(options: VerifierOptions = {}) {
    this.options = {
      sweepGapMs: options.sweepGapMs ?? 120,
      maxConsecutiveFailures: options.maxConsecutiveFailures ?? 3,
      createEdge: options.createEdge ?? createEdgeEngine,
      createServer: options.createServer ?? ((health) => new ServerEngine(api, health)),
      loadCohort: options.loadCohort ?? (() => cohortResource.get()),
      notify:
        options.notify ??
        ((message) => useUiStore.getState().pushToast({ tone: 'warn', message })),
    };
  }

  retain(): void {
    this.refs += 1;
    if (this.refs === 1) this.start();
  }

  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0) this.stop();
  }

  private start(): void {
    this.unsubscribe.push(
      useEngineStore.subscribe((s, prev) => {
        if (s.engine !== prev.engine || s.health !== prev.health) void this.configure();
      }),
      usePatientStore.subscribe((s, prev) => {
        if (s.selectedPatientId !== prev.selectedPatientId) this.focusCurrent();
      }),
    );
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (!isHidden()) this.schedule(0);
      };
      document.addEventListener('visibilitychange', onVisible);
      this.unsubscribe.push(() => document.removeEventListener('visibilitychange', onVisible));
    }
    this.options
      .loadCohort()
      .then((cohort) => {
        for (const p of cohort.patients) if (!this.features.has(p.id)) this.features.set(p.id, p.features);
        useVerificationStore.setState({ total: cohort.patients.length });
        for (const p of cohort.patients) this.enqueue(p.id, false);
        this.schedule(0);
      })
      .catch(() => {
        // No cohort (e.g. API-only deployment without static files): only on-screen patients are checked.
      });
    void this.configure();
  }

  private stop(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.generation += 1;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    useVerificationStore.setState({ active: null });
  }

  /** Pick the engine pair from the resolved engine and the server health. */
  private async configure(): Promise<void> {
    const generation = ++this.generation;
    this.controller?.abort();
    const { engine, health } = useEngineStore.getState();
    this.primary = engine;
    this.secondary = null;
    this.failures = 0;
    useVerificationStore.setState({ ...INITIAL, total: useVerificationStore.getState().total });
    if (!engine) return;

    let secondary: PredictionEngine | null = null;
    let reason: string;
    if (engine.kind === 'server' && health) {
      useVerificationStore.setState({ reason: 'Loading the in-browser engine for the cross-check…' });
      const edge = this.options.createEdge();
      if (await whenEngineReady(edge)) {
        secondary = edge;
        reason = 'Each patient is predicted by the server and by the in-browser engine and compared.';
      } else {
        reason = 'The in-browser engine could not load the model, so the server is not cross-checked.';
      }
    } else if (engine.kind === 'edge' && engine.available && health) {
      secondary = this.options.createServer(health);
      reason = 'Each patient is predicted in the browser and by the server and compared.';
    } else if (engine.kind === 'edge') {
      reason = 'The server is offline, so there is nothing to cross-check the in-browser engine against.';
    } else {
      reason = 'The server is unreachable, so the engines cannot be cross-checked.';
    }
    if (generation !== this.generation) return;
    this.secondary = secondary;
    useVerificationStore.setState({ enabled: secondary !== null, reason, secondary: secondary?.kind ?? null });
    if (secondary) {
      this.queue = [...this.features.keys()];
      this.focusCurrent();
    }
  }

  /** Move the patient on screen to the front of the queue. */
  private focusCurrent(): void {
    const { selectedPatientId, recorded, mode } = usePatientStore.getState();
    if (!selectedPatientId || mode !== 'cohort') return;
    if (!this.features.has(selectedPatientId) && Object.keys(recorded).length > 0) {
      this.features.set(selectedPatientId, recorded);
    }
    this.failures = 0;
    this.enqueue(selectedPatientId, true);
    this.schedule(0);
  }

  private enqueue(key: string, front: boolean): void {
    if (useVerificationStore.getState().records[key]) return;
    this.queue = this.queue.filter((k) => k !== key);
    if (front) this.queue.unshift(key);
    else this.queue.push(key);
  }

  private schedule(delayMs: number): void {
    if (this.refs === 0 || this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delayMs);
  }

  private async pump(): Promise<void> {
    if (this.running || !this.secondary || !this.primary || isHidden()) return;
    if (this.failures >= this.options.maxConsecutiveFailures) return;
    const key = this.queue.shift();
    if (!key) return;
    if (useVerificationStore.getState().records[key] || !this.features.has(key)) {
      this.schedule(0);
      return;
    }
    this.running = true;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    useVerificationStore.setState({ active: { key, since: performance.now() } });
    try {
      const record = await this.verify(key, this.primary, this.secondary, controller.signal);
      if (generation !== this.generation) return;
      this.failures = 0;
      useVerificationStore.setState((s) => ({ records: { ...s.records, [key]: record }, lastError: null }));
      if (!record.agree && !this.warned) {
        this.warned = true;
        const first = record.report.mismatches[0] ?? 'results differ';
        this.options.notify(`Engines disagree for ${key} (${first}). The server's values are shown.`);
      }
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.failures += 1;
      useVerificationStore.setState({ lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      // Always release the slot (a reconfiguration may have aborted this check), then continue:
      // immediately for the patient on screen, paced for the background sweep.
      if (this.controller === controller) this.controller = null;
      this.running = false;
      if (generation === this.generation) useVerificationStore.setState({ active: null });
      const next = this.queue[0];
      this.schedule(next !== undefined && next === usePatientStore.getState().selectedPatientId ? 0 : this.options.sweepGapMs);
    }
  }

  private async verify(key: string, primary: PredictionEngine, secondary: PredictionEngine, signal: AbortSignal): Promise<VerificationRecord> {
    const features = sanitizeFeatures(this.features.get(key)!);
    const [[a, aMs], [b, bMs]] = await Promise.all([
      timed(primary.predict(features, { signal })),
      timed(secondary.predict(features, { signal })),
    ]);
    const byEngine = new Map<EngineKind, [PredictResponse, number]>([
      [a.engine, [a, aMs]],
      [b.engine, [b, bMs]],
    ]);
    const server = byEngine.get('server');
    const edge = byEngine.get('edge');
    // A server that failed over to the edge mid-check would make the comparison meaningless.
    if (!server || !edge) throw new Error('The server did not answer this check itself.');
    const report = compareResponses(edge[0], server[0]);
    return { key, agree: report.agree, report, edgeMs: edge[1], serverMs: server[1], at: Date.now() };
  }
}

/** The app's verifier (one per page, shared by every mounted pill). */
export const engineVerifier = new EngineVerifier();

/** Keep the verifier running while the calling component is mounted (ref-counted). */
export function useEngineVerification(verifier: EngineVerifier = engineVerifier): void {
  useEffect(() => {
    verifier.retain();
    return () => verifier.release();
  }, [verifier]);
}

/** True once the check of `key` has been running for `delayMs` (so fast checks never flicker). */
export function useVerifyingFor(key: string | null, delayMs: number = VERIFYING_DELAY_MS): boolean {
  const active = useVerificationStore((s) => s.active);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!key || !active || active.key !== key) {
      setLate(false);
      return undefined;
    }
    const remaining = delayMs - (performance.now() - active.since);
    setLate(remaining <= 0);
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setLate(true), remaining);
    return () => clearTimeout(timer);
  }, [key, active, delayMs]);
  return late;
}
