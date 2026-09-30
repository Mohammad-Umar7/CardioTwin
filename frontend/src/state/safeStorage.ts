/**
 * localStorage wrapped in try/catch (private windows, blocked site data, quota errors). Every persisted
 * store and every "remember this" flag goes through here, so a storage failure degrades to per-session
 * state instead of throwing during render.
 */
import type { StateStorage } from 'zustand/middleware';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      return storage()?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      storage()?.setItem(name, value);
    } catch {
      /* quota exceeded or blocked: keep the value in memory only */
    }
  },
  removeItem(name) {
    try {
      storage()?.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};
