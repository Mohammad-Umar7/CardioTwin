/**
 * EnginePill state machine (DESIGN_SYSTEM §5 "EnginePill"), kept pure so every state is unit-tested:
 *
 *   Connecting…            health check in flight
 *   Error                  the last estimate failed ("estimate unavailable")
 *   Engines disagree       a cross-check found a difference beyond the contract tolerance (warn)
 *   Verifying              the on-screen patient's cross-check has run > 150 ms
 *   Edge · server offline  the server failed over to the in-browser engine mid-session
 *   Server offline         no engine can produce an estimate (or ?engine=server while it is down)
 *   Server ✓               server numbers on screen
 *   Edge 3 ms [✓]          in-browser numbers on screen (✓ once the server confirmed this patient)
 */
import type { EngineKind } from '@/types/contracts';
import type { EngineStatus, PredictionStatus } from '@/state/patientStore';

export type EnginePillKind = 'connecting' | 'error' | 'disagree' | 'verifying' | 'failover' | 'offline' | 'server' | 'edge';
export type EnginePillTone = 'accent' | 'success' | 'neutral' | 'warn' | 'danger';

export interface EnginePillState {
  kind: EnginePillKind;
  text: string;
  tone: EnginePillTone;
}

export interface EnginePillInput {
  engineStatus: EngineStatus;
  predictionStatus: PredictionStatus;
  /** Engine that produced the numbers currently on screen (`prediction.engine`). */
  predictionEngine: EngineKind | null;
  latencyMs: number | null;
  /** The server answered the health check. */
  serverHealthy: boolean;
  /** The on-screen patient's cross-check has been running for more than 150 ms. */
  verifying: boolean;
  /** At least one cross-check disagreed. */
  disagreement: boolean;
  /** The on-screen patient was cross-checked and both engines agree. */
  currentVerified: boolean;
}

/** Delay before "Verifying" is shown, so fast checks never flicker the pill. */
export const VERIFYING_DELAY_MS = 150;

export function deriveEnginePill(input: EnginePillInput): EnginePillState {
  const { engineStatus } = input;
  if (engineStatus === 'resolving') return { kind: 'connecting', text: 'Connecting…', tone: 'neutral' };
  if (input.predictionStatus === 'error' && engineStatus !== 'unavailable') return { kind: 'error', text: 'Error', tone: 'danger' };
  if (input.disagreement) return { kind: 'disagree', text: 'Engines disagree', tone: 'warn' };
  if (input.verifying) return { kind: 'verifying', text: 'Verifying', tone: 'accent' };
  if (engineStatus === 'server') {
    if (input.predictionEngine === 'edge') return { kind: 'failover', text: 'Edge · server offline', tone: 'accent' };
    if (!input.serverHealthy) return { kind: 'offline', text: 'Server offline', tone: 'neutral' };
    return { kind: 'server', text: 'Server ✓', tone: 'success' };
  }
  if (engineStatus === 'edge') {
    const ms = input.latencyMs !== null ? ` ${Math.max(1, Math.round(input.latencyMs))} ms` : '';
    return { kind: 'edge', text: `Edge${ms}${input.currentVerified ? ' ✓' : ''}`, tone: 'accent' };
  }
  return { kind: 'offline', text: 'Server offline', tone: 'neutral' };
}

/** Compact scientific notation for tolerances in tooltips: 2.2e-16 → "2.2 × 10⁻¹⁶". */
export function formatDelta(x: number): string {
  if (x === 0) return '0';
  if (!Number.isFinite(x)) return '∞';
  const [mantissa, exponent] = x.toExponential(1).split('e');
  const superscript: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const exp = String(Number(exponent))
    .split('')
    .map((c) => superscript[c] ?? c)
    .join('');
  return `${mantissa} × 10${exp}`;
}
