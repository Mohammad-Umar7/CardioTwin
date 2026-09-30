/** StageLayout (WORKSTATION_V2 §4.1, §4.7, §9.2 item 3). */
import { act, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZERO_INSETS, useUiStore } from '@/state/uiStore';
import { ChromeGate, StageLayout } from './StageLayout';
import { computeStageInsets, type InsetInput } from './stageInsets';

const BOXES: Record<string, { width: number; height: number }> = {
  'slot-left': { width: 280, height: 336 },
  'slot-right': { width: 352, height: 452 },
  'slot-bottom': { width: 560, height: 40 },
};

const base: InsetInput = {
  chrome: 'workstation',
  drawer: null,
  stageInset: 12,
  left: BOXES['slot-left']!,
  right: BOXES['slot-right']!,
  bottom: BOXES['slot-bottom']!,
  drawerInputsWidth: 400,
  drawerExplainWidth: 440,
};

describe('computeStageInsets', () => {
  it('matches the binding geometry at 1440×900 at rest (free area x 304–1064, y 60–808)', () => {
    expect(computeStageInsets(base)).toEqual({ left: 304, right: 376, top: 12, bottom: 64 });
  });

  it('counts the collapsed rail instead of the card', () => {
    expect(computeStageInsets({ ...base, left: { width: 40, height: 116 } }).left).toBe(64);
  });

  it('lets a drawer replace the card on its side', () => {
    expect(computeStageInsets({ ...base, drawer: 'inputs' })).toMatchObject({ left: 412, right: 376 });
    expect(computeStageInsets({ ...base, drawer: 'explain', left: { width: 40, height: 116 } })).toMatchObject({
      left: 64,
      right: 452,
    });
  });

  it('centres the heart in focus mode (no cards, no toolbar)', () => {
    const insets = computeStageInsets({ ...base, chrome: 'focus', right: { width: 352, height: 0 } });
    expect(insets.left).toBe(insets.right);
    expect(insets.top).toBe(insets.bottom);
  });

  it('keeps the inspector in the insets when it is shown in focus mode', () => {
    expect(computeStageInsets({ ...base, chrome: 'focus', right: { width: 352, height: 244 } }).right).toBe(376);
  });

  it('ignores empty slots and the hidden toolbar of the tour preset', () => {
    const insets = computeStageInsets({ ...base, chrome: 'tour', left: { width: 0, height: 0 } });
    expect(insets).toEqual({ left: 0, right: 376, top: 12, bottom: 12 });
  });
});

describe('StageLayout', () => {
  const originalW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const originalH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  beforeAll(() => {
    const region = (el: HTMLElement) => el.getAttribute('data-region') ?? '';
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return BOXES[region(this)]?.width ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return BOXES[region(this)]?.height ?? 0;
      },
    });
  });

  afterAll(() => {
    if (originalW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalW);
    if (originalH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalH);
  });

  beforeEach(() => {
    useUiStore.setState({ chrome: 'workstation', drawer: null, stageInsets: ZERO_INSETS });
  });

  const stage = () =>
    render(
      <StageLayout
        canvas={<div data-testid="canvas" />}
        left={<button type="button">Patient</button>}
        right={<button type="button">Risk</button>}
        top={<span>chip</span>}
        bottom={<button type="button">Toolbar</button>}
        bottomLeft={<span>legend</span>}
        overlay={<span>hint</span>}
        drawers={<span>drawers</span>}
      />,
    );

  it('sets data-region on the stage and on every slot', () => {
    const { container } = stage();
    const regions = [...container.querySelectorAll('[data-region]')].map((el) => el.getAttribute('data-region'));
    expect(regions).toEqual(
      expect.arrayContaining([
        'stage',
        'slot-left',
        'slot-right',
        'slot-top',
        'slot-bottom',
        'slot-bottom-left',
        'slot-overlay',
        'slot-drawers',
      ]),
    );
  });

  it('publishes the stage insets it measures', () => {
    stage();
    expect(useUiStore.getState().stageInsets).toEqual({ left: 304, right: 376, top: 12, bottom: 64 });
  });

  it('applies the focus preset: cards slide off and go inert, the canvas node is untouched', () => {
    const { container } = stage();
    const canvas = screen.getByTestId('canvas');
    act(() => useUiStore.getState().setChrome('focus'));
    const left = container.querySelector<HTMLElement>('[data-region="slot-left"]')!;
    const bottom = container.querySelector<HTMLElement>('[data-region="slot-bottom"]')!;
    expect(left).toHaveAttribute('data-visible', 'false');
    expect(left.inert).toBe(true);
    expect(bottom).toHaveAttribute('data-visible', 'false');
    expect(container.querySelector('[data-region="slot-right"]')).toHaveAttribute('data-visible', 'true');
    expect(container.querySelector('[data-region="stage"]')).toHaveAttribute('data-chrome', 'focus');
    // Same node, same wrapper: chrome changes never remount or resize the canvas.
    expect(screen.getByTestId('canvas')).toBe(canvas);
    expect(canvas.parentElement).toHaveClass('absolute', 'inset-0');
    expect(useUiStore.getState().stageInsets.left).toBe(0);
  });

  it('fades the card a drawer docks over and counts the drawer instead', () => {
    const { container } = stage();
    act(() => useUiStore.getState().openDrawer('inputs'));
    expect(container.querySelector('[data-region="slot-left"]')).toHaveAttribute('data-visible', 'false');
    expect(useUiStore.getState().stageInsets.left).toBe(412);
  });

  it('clips with overflow: clip and has no hidden-overflow scroll trap (P0-1)', () => {
    const { container } = stage();
    const root = container.querySelector('[data-region="stage"]')!;
    expect(root).toHaveClass('overflow-clip');
    const traps = [...container.querySelectorAll<HTMLElement>('*')].filter(
      (el) => [...el.classList].some((c) => /^overflow(-[xy])?-hidden$/.test(c)) && el.querySelector('button, input'),
    );
    expect(traps).toEqual([]);
  });

  it('keeps the canvas layer byte-identical across every chrome preset and drawer (no resize, no remount)', () => {
    const { container } = stage();
    const layer = screen.getByTestId('canvas').parentElement!;
    const root = container.querySelector<HTMLElement>('[data-region="stage"]')!;
    const signature = () => [layer.className, layer.getAttribute('style'), root.className, root.getAttribute('style')].join('|');
    const initial = signature();
    const ui = useUiStore.getState();
    const steps: (() => void)[] = [
      () => ui.setChrome('focus'),
      () => ui.setChrome('tour'),
      () => ui.setChrome('landing'),
      () => ui.setChrome('workstation'),
      () => ui.openDrawer('inputs'),
      () => ui.openDrawer('explain'),
      () => ui.closeDrawer(),
      () => ui.setPatientCardOpen(false),
      () => ui.setPatientCardOpen(true),
    ];
    for (const step of steps) {
      act(step);
      expect(signature()).toBe(initial);
      expect(screen.getByTestId('canvas').parentElement).toBe(layer);
    }
  });
});

describe('ChromeGate', () => {
  beforeEach(() => useUiStore.setState({ chrome: 'workstation' }));

  it('hides its card in the listed presets: collapsed, inert and out of the accessibility tree', () => {
    const { container } = render(
      <ChromeGate hideIn={['focus']}>
        <button type="button">Risk card</button>
      </ChromeGate>,
    );
    const gate = container.firstElementChild as HTMLElement;
    expect(gate).toHaveAttribute('data-gate', 'shown');
    expect(gate.inert).toBe(false);
    act(() => useUiStore.getState().setChrome('focus'));
    expect(gate).toHaveAttribute('data-gate', 'hidden');
    expect(gate).toHaveAttribute('aria-hidden', 'true');
    expect(gate.inert).toBe(true);
    expect(gate).toHaveClass('grid-rows-[0fr]', 'opacity-0');
    act(() => useUiStore.getState().setChrome('workstation'));
    expect(gate).toHaveClass('grid-rows-[1fr]', 'opacity-100');
  });
});

describe('slot transitions', () => {
  it('staggers the fade but never the glide, and exits faster than it enters', async () => {
    const { slotTransition } = await import('./stageInsets');
    expect(slotTransition(true, 120, 'translate').transition).toBe(
      'opacity var(--dur-base) var(--ease-out) 120ms, transform var(--dur-base) var(--ease-out) 120ms, translate var(--dur-flyout) var(--ease-out) 0ms',
    );
    expect(slotTransition(false, 30, 'top').transition).toContain('opacity 170ms var(--ease-exit) 30ms');
    expect(slotTransition(false, 30, 'top').transition).toContain('top var(--dur-flyout) var(--ease-out) 0ms');
  });
});

describe('toolbar placement', () => {
  it('centres on the free area at rest (x 684 at 1440) and clears the legend when the free area narrows', async () => {
    const { toolbarOffset } = await import('./stageInsets');
    const rest = { stageWidth: 1440, insets: { left: 304, right: 376, top: 12, bottom: 64 }, width: 560, legendRight: 224, rightLimit: 1440, gap: 12 };
    expect(toolbarOffset(rest) + 720).toBe(684);
    // Explain open (440 px drawer) with the patient rail: the centre would crowd the legend.
    const explain = { ...rest, insets: { left: 64, right: 452, top: 12, bottom: 64 }, width: 600, rightLimit: 1000 };
    const left = toolbarOffset(explain) + 720 - 300;
    expect(left).toBeGreaterThanOrEqual(224 + 12);
    expect(left + 600).toBeLessThanOrEqual(1000 - 12 + 0.001);
    // No legend (tour, focus): pure free-area centre.
    expect(toolbarOffset({ ...explain, legendRight: 0 }) + 720).toBe((64 + 1440 - 452) / 2);
  });
});
