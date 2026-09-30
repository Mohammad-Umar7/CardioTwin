/**
 * WORKSTATION_V2 §9.3 F acceptance: no raw dataset key and no internal model id is visible on
 * Performance or Methodology. Both pages are rendered against the artifacts the app actually ships
 * (public/model, public/anatomy) and their DOM text is grepped, for every target and both splits.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import PerformancePage from '@/features/performance/PerformancePage';
import { KNOWN_MODEL_IDS } from '@/lib/modelNames';
import { manifestResource, metricsResource, schemaResource } from '@/services/staticData';
import type { FeatureSchema } from '@/types/contracts';
import MethodologyPage from './MethodologyPage';

const read = (p: string) => readFileSync(resolve(__dirname, '../../../public', p), 'utf8');
const schema = JSON.parse(read('model/schema.json')) as FeatureSchema;

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.includes('metrics.json')
        ? read('model/metrics.json')
        : url.includes('schema.json')
          ? read('model/schema.json')
          : url.includes('manifest.json')
            ? read('anatomy/manifest.json')
            : null;
      return Promise.resolve(body ? new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 }));
    }),
  );
  await Promise.all([metricsResource.get(), schemaResource.get(), manifestResource.get()]);
  vi.unstubAllGlobals();
});

/**
 * Raw keys that must never be shown: every schema key whose label differs, plus dropped columns and
 * the angiography label, minus keys that legitimately occur inside some human label ("LDL" in
 * "LDL cholesterol").
 */
function forbiddenKeys(): string[] {
  const labels = schema.features.map((f) => f.label);
  const keys = [
    ...schema.features.filter((f) => f.key !== f.label).map((f) => f.key),
    ...(schema.dropped_features ?? []),
    'Cath',
  ];
  return [...new Set(keys)].filter((k) => k.length > 1 && !labels.some((l) => l.includes(k)));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function leaks(text: string): string[] {
  const out: string[] = [];
  for (const k of forbiddenKeys()) {
    if (new RegExp(`(?<![\\w-])${escape(k)}(?![\\w-])`).test(text)) out.push(`key:${k}`);
  }
  for (const id of KNOWN_MODEL_IDS) {
    if (id === 'ensemble') continue; // an ordinary English word
    if (new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`).test(text)) out.push(`model:${id}`);
  }
  return out;
}

/** Visible text plus accessible names and tooltips that a reader can reach. */
function reachableText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`);
  return `${root.textContent ?? ''}\n${attrs.join('\n')}`;
}

describe('human names only (§6.4 rule 3)', () => {
  it('the probe itself catches raw keys and model ids', () => {
    expect(leaks('Region RWMA and EF-TTE, lr_elasticnet')).toEqual(expect.arrayContaining(['key:Region RWMA', 'key:EF-TTE', 'model:lr_elasticnet']));
    expect(leaks('PR-AUC · LDL cholesterol · XGBoost · the ensemble')).toEqual([]);
  });

  for (const t of ['CAD', 'LAD', 'LCX', 'RCA']) {
    for (const split of ['test', 'cv']) {
      it(`Performance shows no raw key or model id (${t}, ${split})`, async () => {
        const { container, unmount } = render(
          <MemoryRouter initialEntries={[`/performance?t=${t}&split=${split}`]}>
            <PerformancePage />
          </MemoryRouter>,
        );
        await waitFor(() => expect(container.querySelector('#summary-title')).not.toBeNull());
        expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Separates /);
        expect(leaks(reachableText(container))).toEqual([]);
        unmount();
      });
    }
  }

  it('Methodology shows no raw key or model id, and every section of its contents exists', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/methodology']}>
        <MethodologyPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector('#models table')).not.toBeNull());
    expect(leaks(reachableText(container))).toEqual([]);
    for (const id of ['pipeline', 'data', 'leakage', 'validation', 'models', 'engines', 'explainability', 'anatomy', 'extensibility', 'model-card', 'limitations', 'references']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    // Three diagrams: pipeline, validation protocol, anatomy build (+ the SHAP margin schematic).
    expect(container.querySelectorAll('figure').length).toBeGreaterThanOrEqual(3);
    // Every external reference opens safely.
    for (const a of container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')) expect(a.rel).toContain('noreferrer');
  });
});
