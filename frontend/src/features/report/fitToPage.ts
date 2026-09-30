/**
 * Fit each report sheet onto exactly one printed page.
 *
 * Content varies by patient (what-if edits add "recorded" lines, a revealed cath result adds a column,
 * long input lists wrap), so instead of hoping it fits, every sheet is measured at its natural size and,
 * only when it would overflow, scaled down with CSS `zoom` (width compensated, so it still spans the
 * page). The same scale is used on screen and in print, so the preview is what prints. Below
 * MIN_FIT the sheet is left to flow onto another page rather than become unreadably small.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

export const MIN_FIT = 0.86;
/** Kept free at the bottom of each page so rounding never spills an empty page (matches report.css). */
export const PAGE_SLACK_MM = 1.5;

export const mmToPx = (mm: number) => (mm * 96) / 25.4;

/** Scale for content of natural height `natural` (px) on a page of `available` px; 1 when it fits. */
export function fitScale(natural: number, available: number, min = MIN_FIT): number {
  if (!(natural > 0) || !(available > 0) || natural <= available) return 1;
  const f = Math.floor((available / natural) * 1000) / 1000;
  return Math.max(min, f);
}

const SHEET_HEIGHT_MM = { a4: 297, letter: 279.4 } as const;

function measure(sheet: HTMLElement, fit: number): number {
  sheet.style.setProperty('--fit', String(fit));
  return sheet.getBoundingClientRect().height;
}

/**
 * Measures every `.rp-sheet` inside `root` whenever `deps` change (and once web fonts have loaded) and
 * sets its `--fit` custom property. Returns the scales, for display and tests.
 */
export function useFitToPage(root: RefObject<HTMLElement>, paper: 'a4' | 'letter', deps: readonly unknown[]): number[] {
  const [fonts, setFonts] = useState(0);
  const [scales, setScales] = useState<number[]>([]);

  useLayoutEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => alive && setFonts((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const sheets = [...el.querySelectorAll<HTMLElement>('.rp-sheet')];
    const available = mmToPx(SHEET_HEIGHT_MM[paper] - PAGE_SLACK_MM);
    const next = sheets.map((sheet) => {
      sheet.classList.add('rp-measure');
      let fit = fitScale(measure(sheet, 1), available);
      // Narrower text wraps less once scaled, so one refinement pass can only relax the scale; check it
      // still fits, and step down if rounding pushed it over.
      if (fit < 1 && measure(sheet, fit) > available) fit = Math.max(MIN_FIT, fit - 0.01);
      sheet.classList.remove('rp-measure');
      sheet.style.setProperty('--fit', String(fit));
      return fit;
    });
    setScales((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [root, paper, fonts, ...deps]);

  return scales;
}
