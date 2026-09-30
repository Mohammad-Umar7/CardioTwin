import { describe, expect, it } from 'vitest';
import { ESCAPE_PRIORITY, hasEscapeLayer, pushEscapeLayer } from './escapeStack';
import {
  ariaKeyShortcuts,
  isSingleKeyChord,
  matchesShortcut,
  parseShortcut,
  shortcutLabels,
  shortcutText,
  withShortcut,
} from './shortcut';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcut grammar', () => {
  it('parses alternatives and modifiers', () => {
    const [ctrlK, slash] = parseShortcut('Mod+K,/');
    expect(ctrlK).toMatchObject({ key: 'k', mod: true });
    expect(slash).toMatchObject({ key: '/', mod: false });
    expect(parseShortcut('0,H').map((c) => c.key)).toEqual(['0', 'h']);
    expect(parseShortcut('Mod++')[0]).toMatchObject({ key: '+', mod: true });
    expect(parseShortcut('+')[0]).toMatchObject({ key: '+' });
    expect(parseShortcut('Esc')[0]!.key).toBe('Escape');
    expect(parseShortcut(undefined)).toEqual([]);
  });

  it('maps Mod to Ctrl elsewhere and ⌘ on macOS', () => {
    expect(matchesShortcut(key('k', { ctrlKey: true }), 'Mod+K', false)).toBe(true);
    expect(matchesShortcut(key('k', { metaKey: true }), 'Mod+K', false)).toBe(false);
    expect(matchesShortcut(key('k', { metaKey: true }), 'Mod+K', true)).toBe(true);
    expect(shortcutText('Mod+K', false)).toBe('Ctrl K');
    expect(shortcutText('Mod+K', true)).toBe('⌘K');
  });

  it('single keys ignore Shift but never fire with Ctrl, Meta or Alt held', () => {
    expect(matchesShortcut(key('I', { shiftKey: true }), 'I')).toBe(true);
    expect(matchesShortcut(key('?', { shiftKey: true }), '?')).toBe(true);
    expect(matchesShortcut(key('i', { ctrlKey: true }), 'I')).toBe(false);
    expect(matchesShortcut(key('\\'), '\\')).toBe(true);
    expect(matchesShortcut(key('h'), '0,H')).toBe(true);
    expect(isSingleKeyChord(parseShortcut('I')[0]!)).toBe(true);
    expect(isSingleKeyChord(parseShortcut('Mod+K')[0]!)).toBe(false);
  });

  it('prints labels for tooltips, Kbd chips and aria-keyshortcuts', () => {
    expect(shortcutLabels('Mod+K,/', false)).toEqual([['Ctrl', 'K'], ['/']]);
    expect(shortcutLabels('Esc')).toEqual([['Esc']]);
    expect(withShortcut('Focus mode', '\\', false)).toBe('Focus mode · \\');
    expect(withShortcut('Home', undefined)).toBe('Home');
    expect(ariaKeyShortcuts('Mod+K,/', false)).toBe('Control+K /');
  });
});

describe('Esc priority chain', () => {
  const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

  it('runs only the topmost layer: palette → menu → drawer → selection → focus', () => {
    const calls: string[] = [];
    const offFocus = pushEscapeLayer(() => calls.push('focus'), ESCAPE_PRIORITY.focus);
    const offSelection = pushEscapeLayer(() => calls.push('selection'), ESCAPE_PRIORITY.selection);
    const offDrawer = pushEscapeLayer(() => calls.push('drawer'), ESCAPE_PRIORITY.drawer);
    const offPalette = pushEscapeLayer(() => calls.push('palette'), ESCAPE_PRIORITY.palette);
    const offMenu = pushEscapeLayer(() => calls.push('menu'), ESCAPE_PRIORITY.menu);
    press();
    offPalette();
    press();
    offMenu();
    press();
    offDrawer();
    press();
    offSelection();
    press();
    offFocus();
    expect(calls).toEqual(['palette', 'menu', 'drawer', 'selection', 'focus']);
    expect(hasEscapeLayer()).toBe(false);
  });

  it('breaks ties by recency and leaves events that were already handled alone', () => {
    const calls: string[] = [];
    const a = pushEscapeLayer(() => calls.push('a'), 40);
    const b = pushEscapeLayer(() => calls.push('b'), 40);
    press();
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    a();
    b();
    expect(calls).toEqual(['b']);
  });
});
