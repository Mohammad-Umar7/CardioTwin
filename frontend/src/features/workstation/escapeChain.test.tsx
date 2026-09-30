/**
 * The Esc priority chain (WORKSTATION_V2 §4.10): one Esc closes exactly one layer, the topmost, in this
 * order: palette → modal → popover/menu → drawer → isolate/ghost → selection → focus mode.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Drawer, Modal } from '@/design';
import CommandPalette from '@/features/shell/CommandPalette';
import { useCommandStore } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { useWorkstationCommands } from './useWorkstationCommands';

function Harness() {
  useWorkstationCommands();
  const drawer = useUiStore((s) => s.drawer);
  const sheet = useUiStore((s) => s.shortcutsOpen);
  const ui = useUiStore.getState;
  return (
    <>
      <Drawer open={drawer === 'inputs'} side="left" onClose={() => ui().closeDrawer()} label="Edit inputs">
        <p>inputs</p>
      </Drawer>
      <Modal open={sheet} onClose={() => ui().setShortcutsOpen(false)} title="Keyboard shortcuts">
        <p>keys</p>
      </Modal>
      <CommandPalette />
    </>
  );
}

const esc = () => act(() => void fireEvent.keyDown(window, { key: 'Escape' }));

const snapshot = () => {
  const ui = useUiStore.getState();
  const v = useViewerStore.getState();
  return {
    palette: ui.paletteOpen,
    modal: ui.shortcutsOpen,
    drawer: ui.drawer,
    isolate: v.isolate,
    selected: v.selectedStructure,
    chrome: ui.chrome,
  };
};

beforeEach(() => {
  useCommandStore.setState({ sources: {}, recent: [] });
  useUiStore.setState({ paletteOpen: false, shortcutsOpen: false, drawer: null, chrome: 'workstation' });
  useViewerStore.setState({ selectedStructure: null, isolate: false, ghostOthers: false });
});

describe('Esc chain', () => {
  it('closes palette, modal, drawer, isolate and selection one per press, topmost first', () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    act(() => {
      useViewerStore.getState().select('LAD');
      useViewerStore.getState().setIsolate(true);
      useUiStore.getState().openDrawer('inputs');
      useUiStore.getState().setShortcutsOpen(true);
      useUiStore.getState().setPaletteOpen(true);
    });
    expect(snapshot()).toEqual({ palette: true, modal: true, drawer: 'inputs', isolate: true, selected: 'LAD', chrome: 'workstation' });
    esc();
    expect(snapshot()).toMatchObject({ palette: false, modal: true, drawer: 'inputs' });
    esc();
    expect(snapshot()).toMatchObject({ modal: false, drawer: 'inputs', isolate: true });
    esc();
    expect(snapshot()).toMatchObject({ drawer: null, isolate: true, selected: 'LAD' });
    esc();
    expect(snapshot()).toMatchObject({ isolate: false, selected: 'LAD' });
    esc();
    expect(snapshot()).toMatchObject({ selected: null, chrome: 'workstation' });
  });

  it('in focus mode, clears the selection first and stays in focus, then leaves focus mode', () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    act(() => {
      useUiStore.getState().toggleFocusMode();
      useViewerStore.getState().select('RCA');
    });
    esc();
    expect(snapshot()).toMatchObject({ selected: null, chrome: 'focus' });
    esc();
    expect(snapshot()).toMatchObject({ chrome: 'workstation' });
    // Nothing left: Esc is a no-op.
    esc();
    expect(snapshot()).toMatchObject({ chrome: 'workstation', selected: null, drawer: null });
  });
});
