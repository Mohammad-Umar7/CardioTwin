/** Canvas HUD (WORKSTATION_V2 §5.11–§5.13, §8.7): peel logic, layers, quality, toolbar and chips. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CMD } from '@/state/commandIds';
import { resolveCommands, useCommandStore } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import { useCameraState } from '@/three/camera/cameraState';
import { CanvasToolbar } from './CanvasToolbar';
import { layerDefault, layerIsDefault, layerVisible, resetLayers } from './layers';
import { LegendChip } from './LegendChip';
import { OPEN_AT, nearestDetent, peelAt, peelPlan, peelValueText, snapToDetent, stepDetent, usePeelPlayer } from './peel';
import { qualityValue, setQuality, tierSummary } from './quality';
import { SelectionChip } from './SelectionChip';

const initialViewer = useViewerStore.getState();

beforeEach(() => {
  useViewerStore.setState({ ...initialViewer, explode: PEEL_REST, selectedStructure: null, layerVisibility: {}, stage: 'workstation' });
  useCameraState.setState({ viewKind: 'home', presetId: null, viewLabel: 'Home' });
});
afterEach(() => usePeelPlayer.getState().stop());

describe('peel detents (V2 §5.11)', () => {
  it('snaps magnetically within ±0.02 of a detent', () => {
    expect(snapToDetent(0.585)).toBe(0.6);
    expect(snapToDetent(0.615)).toBe(0.6);
    expect(snapToDetent(0.55)).toBe(0.55);
    expect(snapToDetent(-0.3)).toBe(0);
    expect(snapToDetent(1.01)).toBe(1);
  });

  it('steps between detents with ← →', () => {
    expect(stepDetent(0.6, 1)).toBe(1);
    expect(stepDetent(0.6, -1)).toBe(0.45);
    expect(stepDetent(0.5, -1)).toBe(0.45);
    expect(stepDetent(0, -1)).toBe(0);
    expect(stepDetent(1, 1)).toBe(1);
  });

  it('names the nearest detent and speaks the value', () => {
    expect(nearestDetent(0.58).label).toBe('Lungs aside');
    expect(peelValueText(0.6)).toBe('Lungs aside');
    expect(peelValueText(0.7)).toMatch(/70 percent open/);
  });

  it('dissects by closing first, then opening to the heart; assembles to rest', () => {
    const plan = peelPlan(0.6, 'dissect');
    expect(plan.map((s) => s.to)).toEqual([0, 1]);
    expect(peelPlan(0, 'dissect')).toHaveLength(1);
    expect(peelPlan(1, 'assemble')).toEqual([{ from: 1, to: PEEL_REST, ms: 1100 }]);
    expect(peelPlan(PEEL_REST, 'assemble')).toEqual([]);
    const total = plan.reduce((a, s) => a + s.ms, 0);
    expect(peelAt(plan, 0).value).toBeCloseTo(0.6, 5);
    expect(peelAt(plan, plan[0]!.ms).value).toBeCloseTo(0, 5);
    expect(peelAt(plan, total + 1)).toEqual({ value: 1, done: true });
  });

  it('jumps straight to the end under reduced motion; P toggles dissect / assemble', () => {
    usePeelPlayer.getState().toggle(true);
    expect(useViewerStore.getState().explode).toBe(1);
    expect(useViewerStore.getState().explode).toBeGreaterThanOrEqual(OPEN_AT);
    usePeelPlayer.getState().toggle(true);
    expect(useViewerStore.getState().explode).toBe(PEEL_REST);
  });
});

describe('layers and quality', () => {
  it('knows each layer default (lungs only on the landing hero) and resets hand changes', () => {
    expect(layerDefault('lungs', 'workstation')).toBe(false);
    expect(layerDefault('lungs', 'hero')).toBe(true);
    expect(layerDefault('skin', 'workstation')).toBe(true);
    useViewerStore.getState().setLayerVisible('skin', false);
    const vis = useViewerStore.getState().layerVisibility;
    expect(layerVisible('skin', vis, 'workstation')).toBe(false);
    expect(layerIsDefault('skin', vis, 'workstation')).toBe(false);
    resetLayers();
    expect(useViewerStore.getState().layerVisibility).toEqual({});
  });

  it('maps the tier lock to Auto / a named tier and back', () => {
    expect(qualityValue('B', false)).toBe('auto');
    expect(qualityValue('C', true)).toBe('C');
    expect(qualityValue('D', true)).toBeNull();
    expect(tierSummary('B', 59.6)).toBe('tier B · 60 fps');
    expect(tierSummary('A', null)).toBe('tier A');
    setQuality('auto');
    expect(useViewerStore.getState().tierLocked).toBe(false);
  });
});

describe('CanvasToolbar (V2 §5.11)', () => {
  it('is one labelled toolbar whose tooltips print "Name · key"', () => {
    render(<CanvasToolbar />);
    const bar = screen.getByRole('toolbar', { name: 'View controls' });
    expect(bar.dataset.region).toBe('toolbar');
    expect(screen.getByRole('button', { name: 'View: Home' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Peel' }).getAttribute('aria-valuetext')).toBe('Lungs aside');
    expect(screen.getByRole('button', { name: 'Explode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Heartbeat' }).getAttribute('aria-pressed')).toBe('true');
    // No always-visible projection buttons, layer chips or disabled controls at rest (V2 §1.7, §5.20).
    expect(screen.queryByRole('radio')).toBeNull();
    expect(bar.querySelectorAll('button:disabled')).toHaveLength(0);
  });

  it('registers the canonical view commands at owner priority (replacing the interim ones)', () => {
    render(<CanvasToolbar />);
    const ids = resolveCommands(useCommandStore.getState().sources).map((c) => c.id);
    for (const id of [CMD.home, CMD.projectionPrev, CMD.projectionNext, CMD.peel, CMD.beat, CMD.flow, CMD.territories, CMD.labels]) {
      expect(ids).toContain(id);
    }
    const peel = resolveCommands(useCommandStore.getState().sources).find((c) => c.id === CMD.peel)!;
    expect(peel.shortcut).toBe('P');
    expect(ids.filter((id) => id.startsWith('view.projection.')).length).toBeGreaterThanOrEqual(6);
  });

  it('steps the peel slider between detents with the arrow keys', () => {
    render(<CanvasToolbar />);
    const slider = screen.getByRole('slider', { name: 'Peel' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useViewerStore.getState().explode).toBe(1);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useViewerStore.getState().explode).toBe(0.45);
  });

  it('shows icons only in the compact stage', () => {
    render(<CanvasToolbar compact />);
    expect(screen.queryByRole('slider', { name: 'Peel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Layers' }).textContent).toBe('');
  });
});

describe('SelectionChip and LegendChip', () => {
  it('renders nothing without a selection, and the vessel with its C-arm angles when selected', () => {
    const { container } = render(<SelectionChip />);
    expect(container.textContent).toBe('');
    act(() => {
      useViewerStore.setState({ selectedStructure: 'LAD', carm: { azimuth: -30, elevation: 25 } });
    });
    expect(screen.getByText('LAD')).toBeTruthy();
    expect(screen.getByText('RAO 30° CRA 25°')).toBeTruthy();
    act(() => useViewerStore.setState({ isolate: true }));
    expect(screen.getByText('Isolated')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End isolate · Esc' })).toBeTruthy();
  });

  it('keeps the legend free of scale numerals at rest and expands on focus', () => {
    render(<LegendChip />);
    const chip = screen.getByRole('img');
    expect(chip.textContent).toBe('LowVery high');
    act(() => chip.focus());
    expect(screen.getByText('Left main · not predicted')).toBeTruthy();
    expect(screen.getByText(/no lesion localisation/)).toBeTruthy();
  });
});

describe('chrome', () => {
  it('toggles focus mode from the toolbar', () => {
    useUiStore.setState({ chrome: 'workstation' });
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(useUiStore.getState().chrome).toBe('focus');
  });
});
