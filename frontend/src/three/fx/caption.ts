/** Wording and placement of the illustrative-flow caption (pure; tested in caption.test.ts). */

export const FLOW_CAPTION = 'Illustrative flow — not a haemodynamic simulation';
export const FLOW_CAPTION_DETAIL =
  'Particles show the direction of coronary blood flow (ostium → distal) and its timing: coronary inflow is ' +
  'mostly diastolic, so it surges as the heart relaxes and nearly stalls while it contracts; the light wave ' +
  'marks that surge once per beat. Density, speed and warmth echo each vessel’s predicted stenosis ' +
  'probability. Nothing here is measured or simulated flow, pressure or FFR.';

/**
 * Where the caption goes: ONE fixed spot on the stage — horizontally centred on the canvas, just above the
 * toolbar row — whatever the workstation chrome does (rest, focus mode, a drawer open), so it never jumps.
 * The canvas never resizes (V2 §4.1) and the toolbar row is reserved at the stage bottom, so this spot is
 * always free. The guided tour hides the toolbar and floats its chapter rail at that height instead, so
 * there the caption drops into the free toolbar row, under the rail.
 */
export function captionPlacement(tour = false): Partial<Record<'left' | 'right' | 'top' | 'bottom' | 'transform', string>> {
  return {
    left: '50%',
    right: '',
    top: '',
    bottom: tour ? 'var(--stage-inset, 12px)' : 'calc(var(--stage-inset, 12px) + var(--toolbar-h, 40px) + 10px)',
    transform: 'translateX(-50%)',
  };
}

/** The caption shows only while flow is really on screen (lit coronaries, heart uncovered, flow faded in). */
export function captionVisible(o: { flowOpacity: number; ignited: boolean; coronarySolid: number; peel: number }): boolean {
  return o.flowOpacity > 0.05 && o.ignited && o.coronarySolid > 0.3 && o.peel >= CAPTION_MIN_PEEL;
}

/** Below "Ribs open" the thorax still covers the heart: no visible flow, so no caption. */
export const CAPTION_MIN_PEEL = 0.45;

/**
 * The caption is a notice, not chrome (V2 §5.13 keeps "Flow is illustrative" in the legend popover and the
 * Flow toggle's tooltip): it shows for this long each time flow comes on screen (the first ignition, Flow
 * switched on, the heart uncovered again), then fades, so the stage at rest carries only its four overlay
 * groups.
 */
export const CAPTION_HOLD_MS = 5000;

/**
 * Whether the caption is up at `now`: flow must be on screen, and it must have come on screen less than
 * `hold` ms ago (`since` = when it last appeared, null while flow is off screen).
 */
export function captionShown(onScreen: boolean, since: number | null, now: number, hold = CAPTION_HOLD_MS): boolean {
  return onScreen && since !== null && now - since < hold;
}
