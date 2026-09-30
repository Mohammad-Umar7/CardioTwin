/** Command palette search and shell (WORKSTATION_V2 §4.9). */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandStore, type Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import CommandPalette from './CommandPalette';
import { initialism, inputAliases, patientKeywords } from './commandAliases';
import { fuzzyScore, searchCommands } from './commandSearch';

const cmd = (id: string, group: Command['group'], title: string, extra: Partial<Command> = {}): Command => ({
  id,
  group,
  title,
  run: vi.fn(),
  ...extra,
});

const COMMANDS: Command[] = [
  cmd('vessel.select.LAD', 'vessels', 'Focus LAD', { subtitle: 'Left anterior descending', shortcut: '1' }),
  cmd('input.typical', 'inputs', 'Typical angina', { subtitle: 'Symptoms', keywords: ['Typical Chest Pain'] }),
  cmd('input.atypical', 'inputs', 'Atypical angina', { subtitle: 'Symptoms', keywords: ['Atypical'] }),
  cmd('input.ef', 'inputs', 'Ejection fraction', { subtitle: 'Echocardiography', keywords: ['EF', 'EF-TTE'] }),
  cmd('flip.typical', 'suggested', 'Flip typical angina'),
  cmd('tour.start', 'actions', 'Start guided demo'),
  cmd('page.performance', 'pages', 'Model performance'),
  cmd('hidden', 'actions', 'Never shown', { when: () => false }),
];

describe('fuzzy search', () => {
  it('ranks prefix > word start > substring > subsequence and rejects non-matches', () => {
    const prefix = fuzzyScore('typ', 'Typical angina')!;
    const word = fuzzyScore('ang', 'Typical angina')!;
    const sub = fuzzyScore('pic', 'Typical angina')!;
    const seq = fuzzyScore('tpa', 'Typical angina')!;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(seq);
    expect(fuzzyScore('xyz', 'Typical angina')).toBeNull();
  });

  it('requires every query word to match', () => {
    expect(fuzzyScore('flip ang', 'Flip typical angina')).not.toBeNull();
    expect(fuzzyScore('flip zzz', 'Flip typical angina')).toBeNull();
  });

  it('finds inputs by alias but groups in the fixed order', () => {
    const sections = searchCommands(COMMANDS, 'ef');
    expect(sections.find((s) => s.group === 'inputs')?.items[0]?.id).toBe('input.ef');
    const order = ['suggested', 'vessels', 'patients', 'inputs', 'views', 'actions', 'pages'];
    const seen = sections.map((s) => order.indexOf(s.group));
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
    const angina = searchCommands(COMMANDS, 'angina').map((s) => s.group);
    expect(angina).toEqual(['suggested', 'inputs']);
  });

  it('shows recents and suggestions first on an empty query and never lists disabled commands', () => {
    const sections = searchCommands(COMMANDS, '', { recent: ['page.performance'] });
    expect(sections[0]).toMatchObject({ group: 'suggested' });
    expect(sections[0]!.items.map((c) => c.id)).toEqual(['page.performance', 'flip.typical']);
    const all = sections.flatMap((s) => s.items.map((c) => c.id));
    expect(all).not.toContain('hidden');
    expect(all.filter((id) => id === 'page.performance')).toHaveLength(1);
  });
});

describe('caps and promoted suggestions', () => {
  const many = Array.from({ length: 300 }, (_, i) => cmd(`patient.open.P-${i}`, 'patients', `P-${String(i).padStart(3, '0')}`));

  it('caps each group on an empty query and while typing, and reports how many were left out', () => {
    const empty = searchCommands(many, '');
    expect(empty).toHaveLength(1);
    expect(empty[0]!.items).toHaveLength(5);
    expect(empty[0]!.more).toBe(295);
    const typed = searchCommands(many, 'p-0');
    expect(typed[0]!.items.length).toBeLessThanOrEqual(8);
    expect(typed[0]!.more).toBeGreaterThan(0);
  });

  it('promotes suggested ids in order when registered and enabled, without repeating them in their group', () => {
    const sections = searchCommands(COMMANDS, '', {
      recent: ['page.performance'],
      suggestedIds: ['tour.start', 'not.registered', 'hidden', 'vessel.select.LAD'],
    });
    expect(sections[0]!.items.map((c) => c.id)).toEqual(['page.performance', 'tour.start', 'vessel.select.LAD', 'flip.typical']);
    const rest = sections.slice(1).flatMap((s) => s.items.map((c) => c.id));
    expect(rest).not.toContain('tour.start');
    expect(rest).not.toContain('vessel.select.LAD');
  });
});

describe('relevance floor', () => {
  it('drops incidental matches when a strong one exists ("ef" → Ejection fraction, not "Left anterior")', () => {
    const ef = cmd('input.edit.EF-TTE', 'inputs', 'Ejection fraction', { subtitle: 'Echocardiography', keywords: ['EF-TTE', 'EF'] });
    const lad = cmd('vessel.select.LAD', 'vessels', 'Focus LAD', { subtitle: 'Left anterior descending artery' });
    const sections = searchCommands([lad, ef], 'ef');
    expect(sections.map((s) => s.group)).toEqual(['inputs']);
    // With nothing strong, weak matches still show.
    expect(searchCommands([lad], 'ef')[0]!.items[0]!.id).toBe('vessel.select.LAD');
  });
});

describe('search aliases', () => {
  it('derives initialisms and raw-key aliases, never repeating the label', () => {
    expect(initialism('Ejection fraction')).toBe('EF');
    expect(initialism('Regional wall-motion abnormality')).toBe('RWMA');
    expect(initialism('Obesity (BMI > 25)')).toBeNull();
    expect(inputAliases({ key: 'EF-TTE', label: 'Ejection fraction' })).toEqual(['EF-TTE', 'EF TTE', 'EF']);
    expect(inputAliases({ key: 'Region RWMA', label: 'Regional wall-motion abnormality' })).toEqual(['Region RWMA', 'RWMA']);
    expect(inputAliases({ key: 'Age', label: 'Age' })).toEqual([]);
  });

  it('finds an input by its abbreviation and a patient by number, split or summary', () => {
    const ef = cmd('input.edit.EF-TTE', 'inputs', 'Ejection fraction', { keywords: inputAliases({ key: 'EF-TTE', label: 'Ejection fraction' }) });
    const rwma = cmd('input.edit.Region RWMA', 'inputs', 'Regional wall-motion abnormality', {
      keywords: inputAliases({ key: 'Region RWMA', label: 'Regional wall-motion abnormality' }),
    });
    expect(searchCommands([ef, rwma], 'rwma')[0]!.items[0]!.id).toBe('input.edit.Region RWMA');
    expect(searchCommands([ef, rwma], 'EF')[0]!.items[0]!.id).toBe('input.edit.EF-TTE');
    const p = cmd('patient.open.P-011', 'patients', 'P-011', {
      keywords: patientKeywords({ id: 'P-011', split: 'test', summary: '58 y · Male · typical angina' }),
    });
    for (const q of ['11', 'test', 'typical', 'male 58']) expect(searchCommands([p], q)).toHaveLength(1);
  });
});

describe('CommandPalette', () => {
  beforeEach(() => {
    useCommandStore.setState({ sources: {}, recent: [] });
    useCommandStore.getState().register('test', COMMANDS);
    useUiStore.setState({ paletteOpen: false, drawer: null });
  });

  it('opens with the input focused, filters as you type and runs the active row with Enter', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<CommandPalette />);
    act(() => useUiStore.getState().setPaletteOpen(true));
    const input = await screen.findByRole('combobox');
    expect(input).toHaveFocus();
    await userEvent.type(input, 'typical');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Flip typical angina');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(COMMANDS[1]!.run).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(useCommandStore.getState().recent[0]).toBe('input.typical');
    opener.remove();
  });

  it('offers two ways out when nothing matches, and Esc closes it', async () => {
    render(<CommandPalette />);
    act(() => useUiStore.getState().setPaletteOpen(true));
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'qqqq');
    expect(screen.getByRole('status')).toHaveTextContent('No match for ‘qqqq’');
    expect(screen.getByRole('option', { name: /Search all/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Show keyboard shortcuts/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(useUiStore.getState().drawer).toBe('inputs');

    act(() => useUiStore.getState().setPaletteOpen(true));
    await screen.findByRole('combobox');
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('opens a row’s actions with Tab and goes back with Backspace', async () => {
    const child = cmd('flip.typical.apply', 'actions', 'Apply and keep');
    useCommandStore.getState().register('with-actions', [
      cmd('input.bp', 'inputs', 'Blood pressure', { actions: [child] }),
    ]);
    render(<CommandPalette />);
    act(() => useUiStore.getState().setPaletteOpen(true));
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'blood');
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('option', { name: /Apply and keep/ })).toBeInTheDocument();
    await userEvent.keyboard('{Backspace}');
    expect(screen.queryByRole('option', { name: /Apply and keep/ })).toBeNull();
  });
});
