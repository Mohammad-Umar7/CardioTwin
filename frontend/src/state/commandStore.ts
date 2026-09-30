/**
 * Command registry (WORKSTATION_V2 §4.9, §9.2 item 5). One registry feeds the command palette, the
 * global keyboard shortcuts, the shortcut sheet and the "Name · key" tooltips, so they can never drift.
 *
 * Features register commands with `useRegisterCommands(source, commands, deps)` (hooks/). A command with a
 * `shortcut` is bound globally by `useCommandHotkeys` (mounted once in the shell) with the §4.10 scoping
 * rules: single keys are suspended while typing, while the palette is open and while a modal is open.
 *
 * Duplicate ids: the registration with the higher `priority` wins; on a tie, the most recent one. The
 * shell registers interim commands for other owners at priority −1 (see `commandIds.ts`), so an owner
 * that registers the same id at the default priority 0 replaces them without coordination.
 */
import type { LucideIcon } from 'lucide-react';
import { create } from 'zustand';
import { safeLocalStorage } from './safeStorage';

export type CommandGroup = 'suggested' | 'vessels' | 'patients' | 'inputs' | 'views' | 'actions' | 'pages';

/** Fixed palette group order; it never changes between keystrokes (V2 §4.9). */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  'suggested',
  'vessels',
  'patients',
  'inputs',
  'views',
  'actions',
  'pages',
];

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  suggested: 'Suggested',
  vessels: 'Vessels & targets',
  patients: 'Patients',
  inputs: 'Inputs',
  views: 'Views',
  actions: 'Actions',
  pages: 'Pages',
};

export interface Command {
  /** Stable id, e.g. "vessel.select.LAD" (canonical ids: state/commandIds.ts). */
  id: string;
  group: CommandGroup;
  /** Human title ("Focus LAD", "Typical angina"). Never a raw dataset key. */
  title: string;
  /** Secondary text ("Symptoms", "Left anterior descending"). */
  subtitle?: string;
  /** Aliases the fuzzy search also matches (raw keys, abbreviations: "EF", "EF-TTE", "RWMA"). */
  keywords?: string[];
  /** Registry-grammar shortcut ("I", "\\", "Mod+K,/", "0,H"); see design/shortcut.ts. */
  shortcut?: string;
  icon?: LucideIcon;
  /** Availability; hidden from the palette and not bound to its shortcut while false. */
  when?: () => boolean;
  /** Right-hand preview of the effect ("CAD 98 % → 91 %"), fetched for the active palette row. */
  preview?: () => string | Promise<string>;
  run: () => void;
  /** Secondary actions, opened with Tab on the palette row (Raycast's action panel). */
  actions?: Command[];
}

export interface RegisterOptions {
  /** Higher wins on duplicate ids and on shortcut conflicts. Default 0; interim fallbacks use −1. */
  priority?: number;
}

interface SourceEntry {
  commands: Command[];
  priority: number;
  seq: number;
}

export interface CommandState {
  sources: Record<string, SourceEntry>;
  /** Most recent first; ids of commands run from the palette. Persisted (last 8). */
  recent: string[];
  register(source: string, commands: Command[], options?: RegisterOptions): void;
  unregister(source: string): void;
  pushRecent(id: string): void;
}

const RECENT_KEY = 'cardiotwin.recentCommands';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = safeLocalStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw as string) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

let seq = 0;

export const useCommandStore = create<CommandState>()((set) => ({
  sources: {},
  recent: loadRecent(),
  register: (source, commands, options = {}) => {
    seq += 1;
    const entry: SourceEntry = { commands, priority: options.priority ?? 0, seq };
    set((s) => ({ sources: { ...s.sources, [source]: entry } }));
  },
  unregister: (source) =>
    set((s) => {
      if (!(source in s.sources)) return s;
      const next = { ...s.sources };
      delete next[source];
      return { sources: next };
    }),
  pushRecent: (id) =>
    set((s) => {
      const recent = [id, ...s.recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
      void safeLocalStorage.setItem(RECENT_KEY, JSON.stringify(recent));
      return { recent };
    }),
}));

interface Ranked {
  command: Command;
  priority: number;
  seq: number;
}

/** Every registered command with duplicates resolved, ordered by group then registration order. */
export function resolveCommands(sources: Record<string, SourceEntry>): Command[] {
  const byId = new Map<string, Ranked>();
  const order: string[] = [];
  const entries = Object.values(sources).sort((a, b) => a.seq - b.seq);
  for (const entry of entries) {
    for (const command of entry.commands) {
      const current = byId.get(command.id);
      if (!current) order.push(command.id);
      if (!current || entry.priority >= current.priority) {
        byId.set(command.id, { command, priority: entry.priority, seq: entry.seq });
      }
    }
  }
  const rank = (g: CommandGroup) => COMMAND_GROUPS.indexOf(g);
  return order
    .map((id, i) => ({ c: byId.get(id)!.command, i }))
    .sort((a, b) => rank(a.c.group) - rank(b.c.group) || a.i - b.i)
    .map((x) => x.c);
}

/** Same as `resolveCommands`, plus each command's winning priority and recency (for shortcut conflicts). */
export function rankedCommands(sources: Record<string, SourceEntry>): Ranked[] {
  const resolved = new Set(resolveCommands(sources));
  const ranked: Ranked[] = [];
  for (const entry of Object.values(sources)) {
    for (const command of entry.commands) {
      if (resolved.has(command)) ranked.push({ command, priority: entry.priority, seq: entry.seq });
    }
  }
  return ranked.sort((a, b) => b.priority - a.priority || b.seq - a.seq);
}

export function isCommandEnabled(command: Command): boolean {
  try {
    return command.when ? command.when() : true;
  } catch {
    return false;
  }
}

export function getCommands(): Command[] {
  return resolveCommands(useCommandStore.getState().sources);
}

export function getCommand(id: string): Command | undefined {
  return getCommands().find((c) => c.id === id);
}

/** Runs a command by id if it exists and is enabled; returns whether it ran. */
export function runCommand(id: string, { recordRecent = false }: { recordRecent?: boolean } = {}): boolean {
  const command = getCommand(id);
  if (!command || !isCommandEnabled(command)) return false;
  if (recordRecent) useCommandStore.getState().pushRecent(id);
  command.run();
  return true;
}
