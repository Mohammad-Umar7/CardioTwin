/** Command registry + shortcut dispatch (WORKSTATION_V2 §4.9, §4.10, §9.2 item 5). */
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commandForKey, useCommandHotkeys, type HotkeyContext } from '@/hooks/useCommandHotkeys';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { getCommands, rankedCommands, runCommand, useCommandStore, type Command } from './commandStore';
import { useUiStore } from './uiStore';

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({
  id,
  group: 'actions',
  title: id,
  run: vi.fn(),
  ...extra,
});

const idle: HotkeyContext = { editable: false, paletteOpen: false, modalOpen: false };
const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

beforeEach(() => {
  useCommandStore.setState({ sources: {}, recent: [] });
  useUiStore.setState({ paletteOpen: false });
});

describe('registry', () => {
  it('orders commands by the fixed group order, then registration order', () => {
    const s = useCommandStore.getState();
    s.register('a', [cmd('page.x', { group: 'pages' }), cmd('act.y')]);
    s.register('b', [cmd('vessel.z', { group: 'vessels' })]);
    expect(getCommands().map((c) => c.id)).toEqual(['vessel.z', 'act.y', 'page.x']);
  });

  it('resolves duplicate ids by priority, then recency; unregistering restores the fallback', () => {
    const s = useCommandStore.getState();
    s.register('owner', [cmd('view.home', { title: 'Owner home' })]);
    s.register('interim', [cmd('view.home', { title: 'Interim home' })], { priority: -1 });
    expect(getCommands().find((c) => c.id === 'view.home')?.title).toBe('Owner home');
    s.register('newer', [cmd('view.home', { title: 'Newer home' })]);
    expect(getCommands().find((c) => c.id === 'view.home')?.title).toBe('Newer home');
    s.unregister('newer');
    s.unregister('owner');
    expect(getCommands().map((c) => c.title)).toEqual(['Interim home']);
  });

  it('runs only enabled commands and records recents when asked', () => {
    const on = cmd('on');
    const off = cmd('off', { when: () => false });
    useCommandStore.getState().register('x', [on, off]);
    expect(runCommand('off')).toBe(false);
    expect(runCommand('on', { recordRecent: true })).toBe(true);
    expect(on.run).toHaveBeenCalledTimes(1);
    expect(off.run).not.toHaveBeenCalled();
    expect(useCommandStore.getState().recent[0]).toBe('on');
  });
});

describe('shortcut dispatch (§4.10)', () => {
  const candidates = (...list: Command[]) => {
    useCommandStore.getState().register('t', list);
    return rankedCommands(useCommandStore.getState().sources).map((r) => r.command);
  };

  it('suspends single keys while typing, in the palette or under a modal; modifiers always work', () => {
    const list = candidates(cmd('inputs', { shortcut: 'I' }), cmd('palette', { shortcut: 'Mod+K,/' }));
    expect(commandForKey(key('i'), list, idle)?.id).toBe('inputs');
    expect(commandForKey(key('i'), list, { ...idle, editable: true })).toBeNull();
    expect(commandForKey(key('i'), list, { ...idle, paletteOpen: true })).toBeNull();
    expect(commandForKey(key('i'), list, { ...idle, modalOpen: true })).toBeNull();
    const ctrlK = navigator.platform.toLowerCase().includes('mac') ? { metaKey: true } : { ctrlKey: true };
    expect(commandForKey(key('k', ctrlK), list, { ...idle, editable: true, paletteOpen: true })?.id).toBe('palette');
    expect(commandForKey(key('/'), list, idle)?.id).toBe('palette');
  });

  it('never treats Esc as a command and skips disabled commands', () => {
    const list = candidates(cmd('esc', { shortcut: 'Esc' }), cmd('iso', { shortcut: 'O', when: () => false }));
    expect(commandForKey(key('Escape'), list, idle)).toBeNull();
    expect(commandForKey(key('o'), list, idle)).toBeNull();
  });

  it('prefers the higher-priority registration on a shared key', () => {
    const s = useCommandStore.getState();
    s.register('palette', [cmd('palette.open', { shortcut: 'Mod+K,/' })]);
    s.register('drawer', [cmd('inputs.search', { shortcut: '/' })], { priority: 1 });
    const list = rankedCommands(useCommandStore.getState().sources).map((r) => r.command);
    expect(commandForKey(key('/'), list, idle)?.id).toBe('inputs.search');
  });
});

function Harness({ run, when }: { run: () => void; when?: () => boolean }) {
  useCommandHotkeys();
  useRegisterCommands('harness', [{ id: 'x.explain', group: 'actions', title: 'Explain', shortcut: 'E', when, run }], []);
  return <input aria-label="field" />;
}

describe('useRegisterCommands + useCommandHotkeys', () => {
  it('registers while mounted, binds the shortcut globally and unregisters on unmount', () => {
    const run = vi.fn();
    const { unmount, getByLabelText } = render(<Harness run={run} />);
    expect(getCommands().map((c) => c.id)).toContain('x.explain');
    fireEvent.keyDown(window, { key: 'e' });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(getByLabelText('field'), { key: 'e' });
    expect(run).toHaveBeenCalledTimes(1);
    unmount();
    expect(getCommands()).toEqual([]);
  });

  it('always calls the latest closure', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness run={first} />);
    rerender(<Harness run={second} />);
    fireEvent.keyDown(window, { key: 'e' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('group-level fallbacks (yieldToGroup)', () => {
  it('drops an interim list once an owner registers any command in the same group', () => {
    const s = useCommandStore.getState();
    s.register('interim.data', [cmd('patient.open.P-001', { group: 'patients' }), cmd('input.edit.EF', { group: 'inputs' })], {
      priority: -1,
      yieldToGroup: true,
    });
    expect(getCommands().map((c) => c.id)).toEqual(['patient.open.P-001', 'input.edit.EF']);
    s.register('patient', [cmd('patient.P-001', { group: 'patients', title: 'P-001' })]);
    expect(getCommands().map((c) => c.id)).toEqual(['patient.P-001', 'input.edit.EF']);
    s.unregister('patient');
    expect(getCommands().map((c) => c.id)).toEqual(['patient.open.P-001', 'input.edit.EF']);
  });

  it('never yields to another fallback source or to interim (priority < 0) commands', () => {
    const s = useCommandStore.getState();
    s.register('a', [cmd('a.1', { group: 'inputs' })], { yieldToGroup: true });
    s.register('b', [cmd('b.1', { group: 'inputs' })], { yieldToGroup: true });
    s.register('interim', [cmd('inputs.reset', { group: 'inputs' })], { priority: -1 });
    expect(getCommands().map((c) => c.id)).toEqual(['a.1', 'b.1', 'inputs.reset']);
  });
});
