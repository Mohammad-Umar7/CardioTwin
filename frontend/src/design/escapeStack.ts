/**
 * Esc priority chain (WORKSTATION_V2 §4.10): one Esc closes exactly one layer, the topmost, in this
 * order: palette → modal → popover/menu → drawer → isolate/ghost → selection → focus mode.
 *
 * Layers register with `useEscapeLayer(active, onEscape, priority)`. A single window `keydown` listener
 * (bubble phase, so a component that handles Esc locally and calls `stopPropagation()` wins) runs the
 * active layer with the highest priority; ties go to the layer that became active most recently.
 */
import { useEffect, useRef } from 'react';

export const ESCAPE_PRIORITY = {
  palette: 60,
  modal: 55,
  menu: 50,
  popover: 50,
  drawer: 40,
  isolate: 30,
  selection: 20,
  focus: 10,
} as const;

interface Layer {
  priority: number;
  seq: number;
  run: () => void;
}

const layers = new Set<Layer>();
let seq = 0;
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const top = topLayer();
  if (!top) return;
  event.preventDefault();
  top.run();
}

function topLayer(): Layer | null {
  let best: Layer | null = null;
  for (const layer of layers) {
    if (!best || layer.priority > best.priority || (layer.priority === best.priority && layer.seq > best.seq)) best = layer;
  }
  return best;
}

function add(layer: Layer) {
  layers.add(layer);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    listening = true;
  }
}

function remove(layer: Layer) {
  layers.delete(layer);
  if (listening && layers.size === 0) {
    window.removeEventListener('keydown', onKeyDown);
    listening = false;
  }
}

/** Registers a layer imperatively; returns the unregister function. Prefer `useEscapeLayer`. */
export function pushEscapeLayer(onEscape: () => void, priority: number): () => void {
  seq += 1;
  const layer: Layer = { priority, seq, run: onEscape };
  add(layer);
  return () => remove(layer);
}

/** True when some layer would consume an Esc press right now (used by tests and the shortcut sheet). */
export function hasEscapeLayer(): boolean {
  return layers.size > 0;
}

/**
 * While `active`, Esc runs `onEscape` if this is the topmost active layer. The latest `onEscape` is used
 * without re-registering, so the layer keeps its place in the stack across renders.
 */
export function useEscapeLayer(active: boolean, onEscape: () => void, priority: number): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer(() => handler.current(), priority);
  }, [active, priority]);
}
