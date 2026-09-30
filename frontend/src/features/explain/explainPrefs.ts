/**
 * Per-viewer presentation choices of the Explain drawer (a convenience, never clinical state): the unit of
 * the contributions, the Why grouping and the Physiology filter. Remembered in localStorage through
 * `safeLocalStorage`, so blocked storage degrades to per-session memory.
 */
import { useSyncExternalStore } from 'react';
import { safeLocalStorage } from '@/state/safeStorage';

/** Percentage points (rescaled, default: the clinician's scale) or the exact SHAP log-odds. */
export type ContributionUnit = 'points' | 'logodds';
export type WhyGrouping = 'feature' | 'modality';

export interface ExplainPrefs {
  unit: ContributionUnit;
  grouping: WhyGrouping;
  abnormalOnly: boolean;
}

const KEY = 'cardiotwin.explain.prefs';
const DEFAULTS: ExplainPrefs = { unit: 'points', grouping: 'feature', abnormalOnly: true };

function load(): ExplainPrefs {
  try {
    const raw = safeLocalStorage.getItem(KEY);
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Partial<ExplainPrefs>) : {};
    return {
      unit: parsed.unit === 'logodds' ? 'logodds' : 'points',
      grouping: parsed.grouping === 'modality' ? 'modality' : 'feature',
      abnormalOnly: parsed.abnormalOnly !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

let prefs: ExplainPrefs | null = null;
const listeners = new Set<() => void>();

const current = (): ExplainPrefs => (prefs ??= load());

export function setExplainPrefs(patch: Partial<ExplainPrefs>): void {
  prefs = { ...current(), ...patch };
  void safeLocalStorage.setItem(KEY, JSON.stringify(prefs));
  listeners.forEach((l) => l());
}

export function useExplainPrefs(): ExplainPrefs {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    current,
    () => DEFAULTS,
  );
}
