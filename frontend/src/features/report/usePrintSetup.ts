/**
 * Print plumbing for the report route:
 *   - paper size (A4 / US Letter), remembered per viewer; defaults to Letter for US/Canadian locales;
 *   - the `@page` rule for that size (rendered as a <style> only while the report is mounted, so printing
 *     any other route is unaffected);
 *   - the document title, which browsers use as the default PDF file name
 *     ("CardioTwin report · P-011 · 2026-09-30"), restored on leave.
 */
import { useEffect, useMemo, useState } from 'react';
import { isoDay, type ReportModel } from './reportModel';

export type PaperSize = 'a4' | 'letter';

const STORAGE_KEY = 'cardiotwin.report.paper';

/** Letter for the locales that use it (US, Canada, Mexico, Philippines…), A4 elsewhere. */
export function defaultPaper(languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [] : []): PaperSize {
  const region = (languages[0] ?? '').split('-')[1]?.toUpperCase();
  return region && ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR'].includes(region) ? 'letter' : 'a4';
}

function readPaper(): PaperSize {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'a4' || v === 'letter') return v;
  } catch {
    /* storage blocked: fall through to the locale default */
  }
  return defaultPaper();
}

/** `@page` CSS for the chosen paper: zero page margins (the sheet's own padding is the margin). */
export function pageCssFor(paper: PaperSize): string {
  return `@page { size: ${paper === 'letter' ? 'letter' : 'A4'} portrait; margin: 0; }`;
}

/** "CardioTwin report · P-011 · 2026-09-30" (characters that are unsafe in file names removed). */
export function reportTitle(model: ReportModel | null): string {
  if (!model) return 'CardioTwin report';
  const label = model.header.patientLabel.replace(/[\\/:*?"<>|]/g, '');
  return `CardioTwin report · ${label} · ${isoDay(model.header.generatedAt)}`;
}

export function usePrintSetup(model: ReportModel | null) {
  const [paper, setPaperState] = useState<PaperSize>(readPaper);
  const setPaper = (p: PaperSize) => {
    setPaperState(p);
    try {
      window.localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* per-session only */
    }
  };

  const title = reportTitle(model);
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  const pageCss = useMemo(() => pageCssFor(paper), [paper]);
  return { paper, setPaper, pageCss };
}
