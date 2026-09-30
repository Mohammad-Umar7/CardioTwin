/**
 * Type-scale lint (WORKSTATION_V2 §5 "11 px is allowed only for overline, Kbd and credits"; LUMEN §3:
 * 11 px is the smallest size allowed). Fails on any text set at 11 px or smaller outside the allowed
 * places: `text-[0.6875rem]`, `text-[11px]`, `text-[10px]`, `text-[0.625rem]`, inline `fontSize: 11` and
 * CSS `font-size: 11px` / `10px`. The overline token (`.eyebrow`, Tailwind `text-overline`) is the
 * sanctioned 11 px style and is not matched.
 *
 * KNOWN_DEBT was a ratchet for files other owners were still converting; the integration pass emptied it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

/**
 * The three sanctioned 11 px uses, plus the overline token's own definition, plus the printed report: its
 * sheet is typeset in print units for A4/Letter paper (11 px ≈ 8 pt), which is not screen UI.
 */
const ALLOWED: Record<string, string> = {
  'design/Kbd.tsx': 'Kbd (mono 11/16)',
  'design/Badge.tsx': 'overline tag (TEST / DEV)',
  'features/shell/DisclaimerBanner.tsx': 'anatomy credit on the status line',
  'styles/globals.css': 'the .eyebrow overline token',
  'features/report/report.css': 'print typography of the A4/Letter sheet',
  'features/report/marks.tsx': 'print typography of the A4/Letter sheet',
};

/**
 * Files still being converted by their owners (path → allowed match count). Never raise a budget. Emptied
 * by the integration pass: any new 11 px text now fails outright.
 */
const KNOWN_DEBT: Record<string, number> = {};

const PATTERN =
  /text-\[(?:0\.6875rem|0\.625rem|11px|10(?:\.5)?px)\]|fontSize:\s*['"]?(?:11|10)(?:px)?['"]?(?![\d.])|font-size:\s*(?:11|10(?:\.5)?)px/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function violations(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    if (rel in ALLOWED) continue;
    const n = readFileSync(file, 'utf-8').match(PATTERN)?.length ?? 0;
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

describe('type scale: 11 px only for overline, Kbd and credits', () => {
  it('matches the forbidden sizes it is meant to catch, and not the overline token', () => {
    const hits = (s: string) => s.match(PATTERN)?.length ?? 0;
    expect(hits('className="text-[0.6875rem] text-tertiary"')).toBe(1);
    expect(hits('text-[10px] text-[11px] text-[0.625rem]')).toBe(3);
    expect(hits('style={{ fontSize: 11 }}')).toBe(1);
    expect(hits('font-size: 11px;')).toBe(1);
    expect(hits('className="eyebrow text-overline text-label text-[0.75rem]"')).toBe(0);
    expect(hits('fontSize: 110')).toBe(0);
  });

  it('adds no new 11 px text and never grows a known debt', () => {
    const found = violations();
    const regressions = Object.entries(found)
      .filter(([file, n]) => n > (KNOWN_DEBT[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${KNOWN_DEBT[file] ?? 0})`);
    expect(regressions, 'Use `label` (12/16) or the overline token instead of 11 px text').toEqual([]);
  });
});
