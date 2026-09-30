import { describe, expect, it } from 'vitest';
import { buildCsv, buildExportSvg } from './exportChart';

const now = new Date('2026-09-30T08:15:00Z');

describe('chart exports carry the watermark (LUMEN §9)', () => {
  it('writes the table as CSV under a commented title, provenance and watermark', () => {
    const csv = buildCsv(
      { columns: ['Model', 'ROC-AUC mean'], rows: [['Deployed ensemble, "tuned"', '0.94'], ['Random forest', 0.94]] },
      { title: 'The deployed ensemble ties the best of 11 models', provenance: 'CardioTwin model 1.1.0 · CAD', now },
    );
    const lines = csv.trimEnd().split('\r\n');
    expect(lines.slice(0, 3)).toEqual([
      '# The deployed ensemble ties the best of 11 models',
      '# CardioTwin model 1.1.0 · CAD · exported 2026-09-30 08:15 UTC',
      '# NOT FOR DIAGNOSTIC USE',
    ]);
    expect(lines[3]).toBe('Model,ROC-AUC mean');
    expect(lines[4]).toBe('"Deployed ensemble, ""tuned""",0.94');
    expect(lines[5]).toBe('Random forest,0.94');
  });

  it('drops non-text cells instead of printing object noise', () => {
    const csv = buildCsv({ columns: ['a'], rows: [[{ type: 'span' }]] }, { title: 't', provenance: 'p', now });
    expect(csv).not.toContain('[object Object]');
  });

  it('frames the SVG with title, provenance and the burned-in disclaimer', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '400');
    svg.setAttribute('height', '200');
    const out = buildExportSvg(svg, { title: 'ROC <CAD>', provenance: 'CardioTwin model 1.1.0', now });
    expect(out).toContain('NOT FOR DIAGNOSTIC USE');
    expect(out).toContain('ROC &lt;CAD&gt;');
    expect(out).toContain('exported 2026-09-30 08:15 UTC');
  });
});
