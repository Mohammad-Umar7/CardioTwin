/**
 * Small hooks shared by the patient components.
 */
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useViewerStore } from '@/state/viewerStore';
import type { TargetId } from '@/types/contracts';

/** The target the patient UI explains: the selected vessel, else CAD. */
export function useCurrentTarget(): TargetId {
  return useViewerStore((s) => s.selectedStructure) ?? 'CAD';
}

/**
 * A counter that increments whenever `value` changes after mount (not on mount): use it as a React `key`
 * to replay a one-shot flash (the 1.2 s accent rule of an edited row, V2 §5.6).
 */
export function useChangeTick(value: unknown): number {
  const [tick, setTick] = useState(0);
  const first = useRef(true);
  const prev = useRef(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!Object.is(prev.current, value)) {
      prev.current = value;
      setTick((t) => t + 1);
    }
  }, [value]);
  return tick;
}

/** The `data-row-id` of the row an element belongs to, or null. */
export function rowIdOf(el: EventTarget | null | undefined): string | null {
  if (!(el instanceof Element)) return null;
  return el.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? null;
}

/**
 * "Expand on focus, not hover" (V2 §5.6): only the row that holds keyboard focus is expanded. Spread
 * `handlers` on the container of the rows; each row carries `data-row-id` and is itself focusable
 * (tabIndex −1), so a click on its non-interactive parts keeps it open.
 */
export function useRowExpansion(initial: string | null = null) {
  const [expanded, setExpanded] = useState<string | null>(initial);
  const handlers = {
    onFocusCapture: (e: FocusEvent) => {
      const id = rowIdOf(e.target);
      if (id) setExpanded(id);
    },
    onBlurCapture: (e: FocusEvent) => {
      // Moving to another row: its focus event expands it.
      if (rowIdOf(e.relatedTarget)) return;
      if (e.relatedTarget) {
        setExpanded(null);
        return;
      }
      // Focus went nowhere (a click on the canvas, a window switch): collapse unless it came straight back.
      const container = e.currentTarget;
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!rowIdOf(active) || !container.contains(active)) setExpanded(null);
      }, 0);
    },
  };
  return { expanded, setExpanded, handlers };
}
