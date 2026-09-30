/**
 * Palette search (WORKSTATION_V2 §4.9): fuzzy subsequence scoring over the title, subtitle and aliases,
 * grouped in a fixed order that never changes between keystrokes.
 */
import { CMD } from '@/state/commandIds';
import {
  COMMAND_GROUPS,
  COMMAND_GROUP_LABELS,
  isCommandEnabled,
  type Command,
  type CommandGroup,
} from '@/state/commandStore';
import type { TargetId } from '@/types/contracts';

/**
 * Suggestions on an empty query (V2 §4.9), resolved against the registry: only registered, enabled ids
 * show. Context first: with a vessel selected, its Explain / Isolate / territory commands lead.
 */
export function paletteSuggestions(selected: TargetId | null): string[] {
  const context = selected ? [CMD.explainVessel(selected), CMD.isolate, CMD.ghost, CMD.territories] : [];
  return [
    ...context,
    ...(selected ? [] : [CMD.selectVessel('LAD')]),
    CMD.peel,
    CMD.reveal,
    CMD.lowRiskPatient,
    CMD.tourStart,
  ];
}

const WORD_START = /[\s\-_/·(.,:]/;

function tokenScore(token: string, text: string): number | null {
  if (!token) return 0;
  if (text === token) return 1000;
  if (text.startsWith(token)) return 900 - Math.min(100, text.length - token.length);
  const word = text.search(new RegExp(`(^|[\\s\\-_/·(.,:])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (word >= 0) return 700 - Math.min(100, word);
  const idx = text.indexOf(token);
  if (idx >= 0) return 600 - Math.min(100, idx);
  // Subsequence: reward word starts and runs, penalise gaps.
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of token) {
    const found = text.indexOf(ch, ti);
    if (found < 0) return null;
    score += 10;
    if (found === 0 || WORD_START.test(text[found - 1]!)) score += 15;
    if (found === prev + 1) score += 8;
    score -= Math.min(10, found - ti);
    prev = found;
    ti = found + 1;
  }
  return Math.min(499, Math.max(1, score));
}

/**
 * Score of `query` against `text` (higher is better), or null when some query word does not match.
 * Every whitespace-separated query word must match; a contiguous match of the whole query adds a bonus.
 */
export function fuzzyScore(query: string, text: string | undefined): number | null {
  if (!text) return null;
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let total = 0;
  for (const token of q.split(/\s+/)) {
    const s = tokenScore(token, t);
    if (s === null) return null;
    total += s;
  }
  if (q.includes(' ') && t.includes(q)) total += 200;
  return total;
}

/** Best score of a command for a query: title first, then aliases, then the subtitle. */
export function commandScore(command: Command, query: string): number | null {
  const scores = [
    fuzzyScore(query, command.title),
    ...(command.keywords ?? []).map((k) => {
      const s = fuzzyScore(query, k);
      return s === null ? null : s * 0.9;
    }),
    (() => {
      const s = fuzzyScore(query, command.subtitle);
      return s === null ? null : s * 0.6;
    })(),
    // "Typical angina · Symptoms"
    (() => {
      const s = fuzzyScore(query, command.subtitle ? `${command.title} ${command.subtitle}` : undefined);
      return s === null ? null : s * 0.8;
    })(),
  ].filter((s): s is number => s !== null);
  return scores.length ? Math.max(...scores) : null;
}

export interface PaletteSection {
  group: CommandGroup;
  label: string;
  items: Command[];
  /** Matches left out by the per-group cap (the palette prints "+ n more"). */
  more?: number;
}

export interface SearchOptions {
  /** Recently run command ids, most recent first (empty query only). */
  recent?: string[];
  /** Ids never listed (e.g. the palette's own command). */
  exclude?: string[];
  /** Max recents shown in Suggested (default 3). */
  recentCount?: number;
  /**
   * Ids promoted into Suggested on an empty query, in order, when registered and enabled (context first:
   * with a vessel selected, "Explain LAD", "Isolate LAD" …). They are not repeated in their own group.
   */
  suggestedIds?: string[];
  /** Per-group cap on an empty query (default 5; Suggested is never capped). */
  emptyLimit?: number;
  /** Per-group cap while typing (default 8). */
  queryLimit?: number;
}

function capped(group: CommandGroup, items: Command[], limit: number): PaletteSection {
  const section: PaletteSection = { group, label: COMMAND_GROUP_LABELS[group], items: items.slice(0, limit) };
  if (items.length > limit) section.more = items.length - limit;
  return section;
}

/**
 * Palette sections for a query. Empty query: Suggested (recents, promoted ids, then `suggested`
 * commands), then every other enabled command by group, capped per group. Typed query: matches ranked
 * by score inside each group, capped per group; groups keep their fixed order. Disabled commands
 * (`when() === false`) are never listed. The caps keep opening and typing O(visible rows), whatever the
 * registry size (303 patients + 53 inputs).
 */
export function searchCommands(commands: Command[], query: string, options: SearchOptions = {}): PaletteSection[] {
  const exclude = new Set(options.exclude ?? []);
  const enabled = commands.filter((c) => !exclude.has(c.id) && isCommandEnabled(c));
  const q = query.trim();
  const sections: PaletteSection[] = [];

  if (!q) {
    const byId = new Map(enabled.map((c) => [c.id, c]));
    const recents = (options.recent ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is Command => !!c)
      .slice(0, options.recentCount ?? 3);
    const promoted = (options.suggestedIds ?? []).map((id) => byId.get(id)).filter((c): c is Command => !!c);
    const suggested = [...new Set([...recents, ...promoted, ...enabled.filter((c) => c.group === 'suggested')])];
    const shown = new Set(suggested);
    const limit = options.emptyLimit ?? 5;
    for (const group of COMMAND_GROUPS) {
      if (group === 'suggested') {
        if (suggested.length) sections.push({ group, label: COMMAND_GROUP_LABELS[group], items: suggested });
        continue;
      }
      const items = enabled.filter((c) => c.group === group && !shown.has(c));
      if (items.length) sections.push(capped(group, items, limit));
    }
    return sections;
  }

  const scored = enabled
    .map((command, i) => ({ command, i, score: commandScore(command, q) }))
    .filter((x): x is { command: Command; i: number; score: number } => x.score !== null);
  const limit = options.queryLimit ?? 8;
  for (const group of COMMAND_GROUPS) {
    const items = scored
      .filter((x) => x.command.group === group)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.command);
    if (items.length) sections.push(capped(group, items, limit));
  }
  return sections;
}
