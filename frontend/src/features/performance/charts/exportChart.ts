/**
 * Chart export with the burned-in watermark (LUMEN §9: every PNG / SVG export carries
 * "NOT FOR DIAGNOSTIC USE" with model version and timestamp). The chart SVG is drawn with hex
 * colours (theme/tokens UI), so a clone renders identically outside the app.
 */
import { UI } from '@/theme/tokens';

export interface ExportOptions {
  title: string;
  /** e.g. "CardioTwin · model 1.1.0 · held-out test (n = 61)" */
  provenance: string;
  filename: string;
  format: 'svg' | 'png';
  /** Injected for tests. */
  now?: Date;
}

const NS = 'http://www.w3.org/2000/svg';
const PAD = 20;
const HEAD = 40;
const FOOT = 32;

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}

/** Build the standalone, watermarked SVG document for a chart root. */
export function buildExportSvg(
  chart: SVGSVGElement,
  opts: Omit<ExportOptions, 'format' | 'filename'>,
): string {
  const w = Number(chart.getAttribute('width')) || chart.getBoundingClientRect().width || 520;
  const h = Number(chart.getAttribute('height')) || chart.getBoundingClientRect().height || 240;
  const W = w + PAD * 2;
  const H = h + HEAD + FOOT + PAD;
  const stamp = (opts.now ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  const inner = chart.cloneNode(true) as SVGSVGElement;
  inner.removeAttribute('class');
  inner.removeAttribute('aria-hidden');
  inner.setAttribute('x', String(PAD));
  inner.setAttribute('y', String(HEAD));
  inner.setAttribute('xmlns', NS);
  const body = new XMLSerializer().serializeToString(inner);
  const font = 'Inter, "Segoe UI", Roboto, system-ui, sans-serif';
  return [
    `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${font}'>`,
    `<rect width="${W}" height="${H}" fill="${UI.bgPanel}"/>`,
    `<text x="${PAD}" y="${PAD + 8}" fill="${UI.textPrimary}" font-size="15" font-weight="600">${escapeXml(opts.title)}</text>`,
    body,
    `<text x="${PAD}" y="${H - 14}" fill="${UI.textTertiary}" font-size="11">${escapeXml(`${opts.provenance} · exported ${stamp} UTC`)}</text>`,
    `<text x="${W - PAD}" y="${H - 14}" fill="${UI.textTertiary}" font-size="11" font-weight="600" letter-spacing="1.3" text-anchor="end">NOT FOR DIAGNOSTIC USE</text>`,
    '</svg>',
  ].join('');
}

export interface CsvTable {
  columns: string[];
  rows: unknown[][];
}

/** A cell as CSV text: numbers and strings verbatim, anything else (React nodes) empty; quoted when needed. */
function csvCell(v: unknown): string {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The "view as table" data as CSV, headed by the same watermark as the image exports (comment lines,
 * so spreadsheet tools still parse the table underneath).
 */
export function buildCsv(table: CsvTable, opts: Omit<ExportOptions, 'format' | 'filename'>): string {
  const stamp = (opts.now ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    `# ${opts.title}`,
    `# ${opts.provenance} · exported ${stamp} UTC`,
    '# NOT FOR DIAGNOSTIC USE',
    table.columns.map(csvCell).join(','),
    ...table.rows.map((r) => r.map(csvCell).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function exportCsv(table: CsvTable, opts: Omit<ExportOptions, 'format'>): void {
  download(new Blob([buildCsv(table, opts)], { type: 'text/csv;charset=utf-8' }), `${opts.filename}.csv`);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the chart as SVG or PNG (2× raster). Resolves when the file has been handed over. */
export async function exportChart(chart: SVGSVGElement, opts: ExportOptions): Promise<void> {
  const svg = buildExportSvg(chart, opts);
  if (opts.format === 'svg') {
    download(new Blob([svg], { type: 'image/svg+xml' }), `${opts.filename}.svg`);
    return;
  }
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Chart image failed to render'));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    download(blob, `${opts.filename}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
