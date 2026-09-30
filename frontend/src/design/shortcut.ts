/**
 * Keyboard shortcut strings shared by the command registry, tooltips, the palette and the shortcut sheet
 * (WORKSTATION_V2 §4.10, §9.2 item 5).
 *
 * Grammar: alternatives separated by "," · each alternative is modifiers + key joined by "+".
 *   "I"            single key (case-insensitive; Shift is ignored unless written)
 *   "\\"           backslash (focus mode)
 *   "Mod+K,/"      Ctrl K on Windows/Linux or ⌘K on macOS, or "/"
 *   "0,H"          either key
 *   "Shift+?"      explicit Shift
 * Modifier names: Mod (Ctrl, or ⌘ on macOS), Ctrl, Meta, Alt, Shift. Key names follow KeyboardEvent.key
 * ("Escape", "ArrowUp", "Enter", " " or "Space"); "Esc" is accepted for "Escape".
 */

export interface Chord {
  /** KeyboardEvent.key, lower-cased for single characters. */
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = { esc: 'Escape', space: ' ', return: 'Enter', del: 'Delete' };

function normaliseKey(key: string): string {
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  return key.length === 1 ? key.toLowerCase() : key;
}

function parseAlternative(alt: string): Chord | null {
  const text = alt.trim();
  if (!text) return null;
  if (text === '+') return { key: '+', mod: false, ctrl: false, meta: false, alt: false, shift: false };
  const parts = text.split('+');
  // "Mod++" → modifiers + the "+" key
  let key = parts.pop() ?? '';
  if (key === '' && parts[parts.length - 1] === '') {
    parts.pop();
    key = '+';
  }
  const mods = new Set(parts.map((p) => p.trim().toLowerCase()));
  return {
    key: normaliseKey(key),
    mod: mods.has('mod'),
    ctrl: mods.has('ctrl') || mods.has('control'),
    meta: mods.has('meta') || mods.has('cmd'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
  };
}

/** All alternatives of a shortcut string (empty for undefined / blank). */
export function parseShortcut(shortcut: string | undefined): Chord[] {
  if (!shortcut) return [];
  // Split on commas that separate alternatives; a lone "," key is not supported.
  return shortcut
    .split(',')
    .map(parseAlternative)
    .filter((c): c is Chord => c !== null);
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** A chord without Ctrl / Meta / Alt / Mod: suspended while typing or while the palette is open. */
export function isSingleKeyChord(chord: Chord): boolean {
  return !chord.mod && !chord.ctrl && !chord.meta && !chord.alt;
}

export function matchesChord(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  chord: Chord,
  mac = isMacPlatform(),
): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key !== chord.key) return false;
  const wantCtrl = chord.ctrl || (chord.mod && !mac);
  const wantMeta = chord.meta || (chord.mod && mac);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== chord.alt) return false;
  if (chord.shift && !event.shiftKey) return false;
  return true;
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  shortcut: string | undefined,
  mac = isMacPlatform(),
): boolean {
  return parseShortcut(shortcut).some((c) => matchesChord(event, c, mac));
}

const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  Enter: '↵',
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Delete: 'Del',
  Tab: 'Tab',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  '-': '−',
};

/** Display labels of one chord, e.g. ["Ctrl", "K"] or ["⌘", "K"]. */
export function chordLabels(chord: Chord, mac = isMacPlatform()): string[] {
  const labels: string[] = [];
  if (chord.ctrl || (chord.mod && !mac)) labels.push(mac ? '⌃' : 'Ctrl');
  if (chord.meta || (chord.mod && mac)) labels.push(mac ? '⌘' : 'Win');
  if (chord.alt) labels.push(mac ? '⌥' : 'Alt');
  if (chord.shift) labels.push(mac ? '⇧' : 'Shift');
  labels.push(KEY_LABELS[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return labels;
}

/** Display labels of every alternative: [["Ctrl","K"], ["/"]]. */
export function shortcutLabels(shortcut: string | undefined, mac = isMacPlatform()): string[][] {
  return parseShortcut(shortcut).map((c) => chordLabels(c, mac));
}

/** Plain text for tooltips and aria-keyshortcuts-like copy: "Ctrl K" / "⌘K" (first alternative). */
export function shortcutText(shortcut: string | undefined, mac = isMacPlatform()): string {
  const first = parseShortcut(shortcut)[0];
  if (!first) return '';
  const labels = chordLabels(first, mac);
  return mac ? labels.join('') : labels.join(' ');
}

/** Tooltip copy "Name · key" (V2 §5.11); just the name when there is no shortcut. */
export function withShortcut(name: string, shortcut: string | undefined, mac = isMacPlatform()): string {
  const text = shortcutText(shortcut, mac);
  return text ? `${name} · ${text}` : name;
}

/** `aria-keyshortcuts` value ("Control+K Meta+K" style) for the first alternative. */
export function ariaKeyShortcuts(shortcut: string | undefined, mac = isMacPlatform()): string | undefined {
  const all = parseShortcut(shortcut);
  if (all.length === 0) return undefined;
  return all
    .map((c) => {
      const parts: string[] = [];
      if (c.ctrl || (c.mod && !mac)) parts.push('Control');
      if (c.meta || (c.mod && mac)) parts.push('Meta');
      if (c.alt) parts.push('Alt');
      if (c.shift) parts.push('Shift');
      parts.push(c.key === ' ' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key);
      return parts.join('+');
    })
    .join(' ');
}
