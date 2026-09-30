/** Shortcut sheet v2 (WORKSTATION_V2 §5.19): generated from the registry, four sections in two columns. */
import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CMD, SHORTCUT } from '@/state/commandIds';
import { useCommandStore, type Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import ShortcutSheet from './ShortcutSheet';
import { sheetRows, sheetSection } from './shortcutSections';

const cmd = (id: string, group: Command['group'], title: string, shortcut?: string): Command => ({
  id,
  group,
  title,
  shortcut,
  run: vi.fn(),
});

const REGISTRY: Command[] = [
  cmd(CMD.selectVessel('LAD'), 'vessels', 'Focus LAD', '1'),
  cmd(CMD.selectVessel('LCX'), 'vessels', 'Focus LCX', '2'),
  cmd(CMD.selectVessel('RCA'), 'vessels', 'Focus RCA', '3'),
  cmd(CMD.paletteOpen, 'actions', 'Command palette', SHORTCUT.palette),
  cmd(CMD.inputsDrawer, 'actions', 'Edit inputs', SHORTCUT.inputs),
  cmd(CMD.explainDrawer, 'actions', 'Explain', SHORTCUT.explain),
  cmd(CMD.isolate, 'views', 'Isolate', SHORTCUT.isolate),
  cmd(CMD.focusMode, 'views', 'Focus mode', SHORTCUT.focusMode),
  cmd(CMD.shortcuts, 'actions', 'Keyboard shortcuts', SHORTCUT.shortcuts),
  cmd('page.performance', 'pages', 'Model performance'),
];

describe('sheet sections', () => {
  it('sorts commands into Navigate, Inspect, Edit and View', () => {
    expect(sheetSection({ id: CMD.paletteOpen, group: 'actions' })).toBe('navigate');
    expect(sheetSection({ id: CMD.explainDrawer, group: 'actions' })).toBe('inspect');
    expect(sheetSection({ id: CMD.isolate, group: 'views' })).toBe('inspect');
    expect(sheetSection({ id: CMD.inputsDrawer, group: 'actions' })).toBe('edit');
    expect(sheetSection({ id: CMD.beat, group: 'views' })).toBe('view');
    expect(sheetSection({ id: 'input.edit.Age', group: 'inputs' })).toBe('edit');
  });

  it('merges the vessel keys into one row, skips commands without keys and the sheet itself', () => {
    const rows = sheetRows(REGISTRY);
    expect(rows.inspect[0]).toMatchObject({ action: 'Select LAD / LCX / RCA', shortcuts: ['1', '2', '3'] });
    const all = Object.values(rows).flat().map((r) => r.action);
    expect(all).not.toContain('Model performance');
    expect(all).not.toContain('Keyboard shortcuts');
    expect(rows.navigate.map((r) => r.action)).toEqual(['Command palette', 'Close the top layer']);
    expect(rows.edit.map((r) => r.action)).toEqual(['Edit inputs']);
  });
});

describe('ShortcutSheet', () => {
  beforeEach(() => {
    useCommandStore.setState({ sources: {}, recent: [] });
    useCommandStore.getState().register('test', REGISTRY);
  });

  it('renders the four sections from the registry', async () => {
    render(<ShortcutSheet />);
    act(() => useUiStore.getState().setShortcutsOpen(true));
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const title of ['Navigate', 'Inspect', 'Edit', 'View']) expect(within(dialog).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(within(dialog).getByText('Select LAD / LCX / RCA')).toBeInTheDocument();
    act(() => useUiStore.getState().setShortcutsOpen(false));
  });
});
