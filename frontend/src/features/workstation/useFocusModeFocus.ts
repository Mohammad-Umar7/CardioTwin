import { useEffect, useRef } from 'react';
import { useUiStore } from '@/state/uiStore';

/** After the chrome transition (answer pill enter 120 ms + base 240 ms), where focus lands is settled. */
const SETTLE_MS = 320;

/** Focus is lost: on <body>, gone from the document, or inside chrome that just turned inert / hidden. */
export function focusIsLost(active: Element | null = document.activeElement): boolean {
  return !active || active === document.body || !active.isConnected || !!active.closest('[inert],[aria-hidden="true"]');
}

function focusFirst(selectors: readonly string[]): void {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && !el.closest('[inert],[aria-hidden="true"]')) {
      // `focusVisible` (where supported) shows the ring even after a pointer click.
      el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
      if (document.activeElement === el) return;
    }
  }
}

/**
 * Keeps keyboard focus on a real control across focus mode (WCAG 2.4.3): the toolbar's Focus-mode button
 * hides with the toolbar, so entering focus mode hands focus to the answer pill's Exit button, and leaving it
 * (Esc, \, or Exit) hands it back to the Focus-mode button — only when focus was actually lost (a deliberate
 * target, such as the Risk card after clicking the pill's numeral, is left alone).
 */
export function useFocusModeFocus(): void {
  const chrome = useUiStore((s) => s.chrome);
  const prev = useRef(chrome);
  useEffect(() => {
    const from = prev.current;
    prev.current = chrome;
    if (from === chrome) return;
    let target: readonly string[] | null = null;
    if (chrome === 'focus') target = ['[data-region="answer-pill"] button[aria-keyshortcuts]'];
    else if (from === 'focus' && chrome === 'workstation') {
      target = ['[data-region="toolbar"] button[aria-label="Focus mode"]', '#risk-summary'];
    }
    if (!target) return;
    const leaving = chrome !== 'focus';
    const t = window.setTimeout(() => {
      const active = document.activeElement;
      // Leaving: the answer pill is on its way out, so focus still on it is lost too.
      if (focusIsLost(active) || (leaving && !!active?.closest('[data-region="answer-pill"]'))) focusFirst(target!);
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [chrome]);
}
