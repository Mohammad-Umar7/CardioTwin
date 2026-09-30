/**
 * Shortcut sheet layout (WORKSTATION_V2 §5.19): the registry's shortcuts sorted into four sections,
 * Navigate · Inspect (left column) and Edit · View (right column). Pure, so the sheet and its test agree.
 */
import { CMD } from '@/state/commandIds';
import type { Command, CommandGroup } from '@/state/commandStore';

export type SheetSection = 'navigate' | 'inspect' | 'edit' | 'view';

export const SHEET_COLUMNS: { sections: { id: SheetSection; title: string }[] }[] = [
  {
    sections: [
      { id: 'navigate', title: 'Navigate' },
      { id: 'inspect', title: 'Inspect' },
    ],
  },
  {
    sections: [
      { id: 'edit', title: 'Edit' },
      { id: 'view', title: 'View' },
    ],
  },
];

/** Ids whose section is not implied by their palette group. */
const BY_ID: Record<string, SheetSection> = {
  [CMD.paletteOpen]: 'navigate',
  [CMD.shortcuts]: 'navigate',
  [CMD.tourStart]: 'navigate',
  [CMD.details]: 'navigate',
  [CMD.explainDrawer]: 'inspect',
  [CMD.home]: 'inspect',
  [CMD.isolate]: 'inspect',
  [CMD.ghost]: 'inspect',
  [CMD.inputsDrawer]: 'edit',
  [CMD.resetEdits]: 'edit',
};

const BY_GROUP: Record<CommandGroup, SheetSection> = {
  suggested: 'navigate',
  pages: 'navigate',
  patients: 'navigate',
  vessels: 'inspect',
  inputs: 'edit',
  views: 'view',
  actions: 'view',
};

export function sheetSection(command: Pick<Command, 'id' | 'group'>): SheetSection {
  return BY_ID[command.id] ?? BY_GROUP[command.group];
}

export interface SheetRow {
  key: string;
  action: string;
  /** Registry-grammar shortcuts, one per key cluster ("1", "2", "3" for the vessels). */
  shortcuts: string[];
}

/** Keys that act on the focused canvas or on a layer, not through a registered command. */
const STATIC_ROWS: Record<SheetSection, SheetRow[]> = {
  navigate: [{ key: 'esc', action: 'Close the top layer', shortcuts: ['Esc'] }],
  inspect: [],
  edit: [{ key: 'compare', action: 'Hold to compare with the recorded estimate', shortcuts: ['R'] }],
  view: [
    { key: 'orbit', action: 'Orbit 15° (canvas focused)', shortcuts: ['ArrowLeft', 'ArrowRight'] },
    { key: 'zoom', action: 'Zoom (canvas focused)', shortcuts: ['+', '-'] },
  ],
};

const VESSEL_SELECT = /^vessel\.select\.(.+)$/;

/**
 * Rows of each section, in registry order. The per-vessel select commands (1 2 3) merge into one row,
 * "Select LAD / LCX / RCA", so the sheet stays short.
 */
export function sheetRows(commands: readonly Command[]): Record<SheetSection, SheetRow[]> {
  const out: Record<SheetSection, SheetRow[]> = { navigate: [], inspect: [], edit: [], view: [] };
  const vessels: { target: string; shortcut: string }[] = [];
  for (const c of commands) {
    if (!c.shortcut || c.id === CMD.shortcuts) continue;
    const vessel = VESSEL_SELECT.exec(c.id);
    if (vessel) {
      vessels.push({ target: vessel[1]!, shortcut: c.shortcut });
      continue;
    }
    out[sheetSection(c)].push({ key: c.id, action: c.title, shortcuts: [c.shortcut] });
  }
  if (vessels.length) {
    out.inspect.unshift({
      key: 'vessel.select',
      action: `Select ${vessels.map((v) => v.target).join(' / ')}`,
      shortcuts: vessels.map((v) => v.shortcut),
    });
  }
  for (const section of Object.keys(out) as SheetSection[]) out[section].push(...STATIC_ROWS[section]);
  return out;
}
