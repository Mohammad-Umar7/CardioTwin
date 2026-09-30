import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useUiStore, type Chrome } from '@/state/uiStore';
import { CHROME_SLOTS, columnOverflows, computeStageInsets, slotTransition, toolbarOffset } from './stageInsets';

export interface StageLayoutProps {
  /** Full-bleed canvas layer (the workstation <CanvasSlot/>). It never changes size. */
  canvas: ReactNode;
  /** Patient card or its 40 px rail (hugs its content; x 12, y 12). */
  left?: ReactNode;
  /** Right column: Risk summary card + vessel inspector. Scrolls as one unit if taller than the stage − 24. */
  right?: ReactNode;
  /** Context slot, top-centre of the free area: selection chip, what-if pill (8 px gap). */
  top?: ReactNode;
  /** Canvas toolbar, bottom-centre of the free area. */
  bottom?: ReactNode;
  /** Legend chip, bottom-left. */
  bottomLeft?: ReactNode;
  /** Docked drawers (Inputs left, Explain right); they position themselves (design/Drawer). */
  drawers?: ReactNode;
  /** Always-mounted overlay (answer pill, first-run hint); children position themselves. */
  overlay?: ReactNode;
  /** What-if stage frame: 1 px accent inset outline at 40 % (V2 §5.7). */
  frame?: boolean;
  /** Override the store's chrome preset (tests, previews). */
  chrome?: Chrome;
  className?: string;
}

/** Stage inset fallback when the CSS variable cannot be read (jsdom). */
const INSET_FALLBACK = 12;
/** Answer pill height + card gap: the right column moves below the pill in focus mode. */
const FOCUS_RIGHT_DROP = 'calc(40px + var(--card-gap))';

function cssPx(el: Element, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function Slot({
  name,
  visible,
  hideTo,
  delay = 0,
  glide = 'top',
  className,
  style,
  slotRef,
  children,
}: {
  name: string;
  visible: boolean;
  hideTo: 'left' | 'right' | 'top' | 'bottom' | 'none';
  delay?: number;
  /** Layout property that glides without the stagger: `translate` (centred slots) or `top`. */
  glide?: 'translate' | 'top';
  className?: string;
  style?: CSSProperties;
  slotRef?: (el: HTMLDivElement | null) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Hidden chrome leaves the tab order and the accessibility tree while it slides off.
    if (ref.current) ref.current.inert = !visible;
  }, [visible]);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        slotRef?.(el);
      }}
      data-region={`slot-${name}`}
      data-visible={visible}
      aria-hidden={visible ? undefined : true}
      style={{ ...style, ...slotTransition(visible, delay, glide) }}
      className={cn(
        'absolute z-panels',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        !visible && hideTo === 'left' && '-translate-x-3 motion-reduce:translate-x-0',
        !visible && hideTo === 'right' && 'translate-x-3 motion-reduce:translate-x-0',
        !visible && hideTo === 'top' && '-translate-y-1 motion-reduce:translate-y-0',
        !visible && hideTo === 'bottom' && 'translate-y-3 motion-reduce:translate-y-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Hides its card in the given chrome presets while its slot stays shown (WORKSTATION_V2 §4.8, §8.1): the
 * Risk card leaves the right column in focus mode while the inspector stays. Exit: toward `edge` by
 * 12 px + fade over 170 ms while the height collapses (no reflow jump below it); enter: the reverse over
 * `base`. Hidden content is inert and out of the accessibility tree.
 */
export function ChromeGate({
  hideIn,
  edge = 'right',
  children,
}: {
  hideIn: readonly Chrome[];
  edge?: 'left' | 'right';
  children: ReactNode;
}) {
  const chrome = useUiStore((s) => s.chrome);
  const hidden = hideIn.includes(chrome);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = hidden;
  }, [hidden]);
  return (
    <div
      ref={ref}
      data-gate={hidden ? 'hidden' : 'shown'}
      aria-hidden={hidden || undefined}
      className={cn(
        'grid transition-[grid-template-rows,opacity,transform,margin]',
        hidden
          ? cn(
              'pointer-events-none -mb-[var(--card-gap)] grid-rows-[0fr] opacity-0 duration-[170ms] ease-exit motion-reduce:translate-x-0',
              edge === 'right' ? 'translate-x-3' : '-translate-x-3',
            )
          : 'grid-rows-[1fr] opacity-100 duration-base ease-out',
      )}
    >
      <div className={cn('min-h-0', hidden && 'overflow-clip')}>{children}</div>
    </div>
  );
}

/**
 * The V2 workstation stage (WORKSTATION_V2 §4): a full-bleed canvas that never resizes, with opaque stage
 * cards floating at a 12 px inset in named slots. It
 *   - sets `data-region` on every slot (`slot-left`, `slot-right`, `slot-top`, `slot-bottom`,
 *     `slot-bottom-left`, `slot-drawers`, `slot-overlay`) and on the stage (`stage`);
 *   - applies the chrome preset (`uiStore.chrome`): hidden slots slide 12 px toward their edge and fade
 *     (170 ms exit, 240 ms enter, 30 ms stagger), become inert, and stop counting in the insets;
 *   - fades the card a drawer docks over (Inputs covers the left card, Explain the right column);
 *   - measures the slots with a ResizeObserver and publishes `uiStore.stageInsets`; the context slot and
 *     the toolbar glide to the free area's centre over `flyout`.
 * The stage root clips with `overflow: clip` (P0-1: never a scrollable `hidden`).
 */
export function StageLayout({
  canvas,
  left,
  right,
  top,
  bottom,
  bottomLeft,
  drawers,
  overlay,
  frame = false,
  chrome: chromeOverride,
  className,
}: StageLayoutProps) {
  const storeChrome = useUiStore((s) => s.chrome);
  const drawer = useUiStore((s) => s.drawer);
  const insets = useUiStore((s) => s.stageInsets);
  const chrome = chromeOverride ?? storeChrome;
  const show = CHROME_SLOTS[chrome];
  // Leaving focus mode is the exact reverse of entering it: the answer pill exits first (170 ms), then
  // the cards enter with the first-paint stagger (V2 §8.1).
  const prevChrome = useRef(chrome);
  const enterAfter = prevChrome.current === 'focus' && chrome !== 'focus' ? 120 : 0;
  useEffect(() => {
    prevChrome.current = chrome;
  }, [chrome]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const [rightScrolls, setRightScrolls] = useState(false);
  /** Toolbar offset from the stage centre; null until measured (then it follows the free-area centre). */
  const [bottomDx, setBottomDx] = useState<number | null>(null);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = (el: HTMLElement | null) => ({ width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 });
    const next = computeStageInsets({
      chrome,
      drawer,
      stageInset: cssPx(stage, '--stage-inset', INSET_FALLBACK),
      left: box(leftRef.current),
      right: box(rightRef.current),
      bottom: box(bottomRef.current),
      drawerInputsWidth: cssPx(stage, '--drawer-inputs-w', 400),
      drawerExplainWidth: cssPx(stage, '--drawer-explain-w', 440),
    });
    useUiStore.getState().setStageInsets(next);
    const col = rightRef.current;
    if (col) setRightScrolls(columnOverflows(col));
    // The toolbar shares the bottom band with the legend chip (and a docked drawer): keep clear of both.
    const g = cssPx(stage, '--stage-inset', INSET_FALLBACK);
    const legendShown = CHROME_SLOTS[chrome].bottomLeft && drawer !== 'inputs';
    const legendW = legendShown ? (legendRef.current?.offsetWidth ?? 0) : 0;
    const stageWidth = stage.offsetWidth;
    const toolbarW = bottomRef.current?.offsetWidth ?? 0;
    if (stageWidth > 0 && toolbarW > 0) {
      const dx = toolbarOffset({
        stageWidth,
        insets: next,
        width: toolbarW,
        legendRight: legendW > 0 ? g + legendW : 0,
        rightLimit: drawer === 'explain' ? stageWidth - cssPx(stage, '--drawer-explain-w', 440) : stageWidth,
        gap: g,
      });
      setBottomDx((prev) => (prev !== null && Math.abs(prev - dx) < 0.5 ? prev : dx));
    }
  }, [chrome, drawer]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    const observe = (el: Element | null) => {
      if (!el) return;
      ro.observe(el);
      for (const child of el.children) ro.observe(child);
    };
    [stageRef.current, leftRef.current, rightRef.current, bottomRef.current, legendRef.current].forEach(observe);
    // Cards mount and unmount inside the slots (inspector on selection): re-observe their children.
    const mo = new MutationObserver(() => {
      [leftRef.current, rightRef.current, bottomRef.current, legendRef.current].forEach(observe);
      measure();
    });
    [leftRef.current, rightRef.current, bottomRef.current, legendRef.current].forEach((el) => el && mo.observe(el, { childList: true }));
    // Entry slides and chrome glides change no box size, so the observers stay silent when they end:
    // re-measure once they settle (coalesced to one frame).
    let frame = 0;
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    const stage = stageRef.current;
    stage?.addEventListener('transitionend', settle);
    stage?.addEventListener('animationend', settle);
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
      stage?.removeEventListener('transitionend', settle);
      stage?.removeEventListener('animationend', settle);
    };
  }, [measure]);

  // Centre of the free area, for the context slot and the toolbar. They sit at the stage centre and move
  // with the independent `translate` property (glides over `flyout`), never `left`: a translation is not
  // a layout shift, so late-arriving cards never add to CLS (V2 §8.6).
  const dx = (insets.left - insets.right) / 2;
  const centred: CSSProperties = { left: '50%', translate: `calc(-50% + ${dx}px) 0` };
  const toolbarPlaced: CSSProperties = { left: '50%', translate: `calc(-50% + ${bottomDx ?? dx}px) 0` };

  return (
    <div
      ref={stageRef}
      data-region="stage"
      data-chrome={chrome}
      className={cn('relative isolate h-full w-full overflow-clip bg-void', className)}
    >
      <div className="absolute inset-0 z-canvas">{canvas}</div>

      <div
        aria-hidden
        data-region="stage-frame"
        className={cn(
          'pointer-events-none absolute inset-0 z-labels shadow-[inset_0_0_0_1px_rgb(var(--c-accent)/0.4)] transition-opacity duration-base ease-out',
          frame ? 'opacity-100' : 'opacity-0',
        )}
      />

      <Slot
        name="left"
        visible={show.left && drawer !== 'inputs'}
        hideTo="left"
        delay={show.left ? enterAfter + 60 : 0}
        slotRef={(el) => (leftRef.current = el)}
        className="left-[var(--stage-inset)] top-[var(--stage-inset)] flex max-h-[calc(100%-2*var(--stage-inset)-var(--toolbar-h)-var(--card-gap))] flex-col items-start"
      >
        {left}
      </Slot>

      <Slot
        name="right"
        visible={show.right && drawer !== 'explain'}
        hideTo="right"
        delay={show.right ? enterAfter : 30}
        glide="translate"
        slotRef={(el) => (rightRef.current = el)}
        style={{
          // Moved with `translate` (not `top`), so the drop below the answer pill is never a layout shift.
          top: 'var(--stage-inset)',
          translate: chrome === 'focus' ? `0 ${FOCUS_RIGHT_DROP}` : '0 0',
          maxHeight: `calc(100% - 2 * var(--stage-inset)${chrome === 'focus' ? ` - ${FOCUS_RIGHT_DROP}` : ''})`,
        }}
        className={cn(
          'right-[var(--stage-inset)] flex w-[var(--card-right-w)] flex-col gap-[var(--card-gap)]',
          // Scrolls as one unit only when it must; a 1 px pad keeps the cards' rings unclipped.
          rightScrolls && 'panel-scroll -m-px p-px',
        )}
      >
        {right}
      </Slot>

      <Slot
        name="top"
        visible={show.top}
        hideTo="top"
        style={centred}
        glide="translate"
        className="top-[var(--stage-inset)] flex items-center gap-2"
      >
        {top}
      </Slot>

      <Slot
        name="bottom"
        visible={show.bottom}
        hideTo="bottom"
        delay={show.bottom ? enterAfter + 120 : 60}
        slotRef={(el) => (bottomRef.current = el)}
        style={toolbarPlaced}
        glide="translate"
        className="bottom-[var(--stage-inset)] flex items-end"
      >
        {bottom}
      </Slot>

      <Slot
        name="bottom-left"
        visible={show.bottomLeft}
        hideTo="bottom"
        delay={show.bottomLeft ? enterAfter + 180 : 90}
        slotRef={(el) => (legendRef.current = el)}
        className="bottom-[var(--stage-inset)] left-[var(--stage-inset)]"
      >
        {bottomLeft}
      </Slot>

      <div data-region="slot-overlay" className="pointer-events-none absolute inset-0 z-panels [&>*]:pointer-events-auto">
        {overlay}
      </div>

      <div data-region="slot-drawers" className="pointer-events-none absolute inset-0 z-flyout">
        {drawers}
      </div>
    </div>
  );
}
