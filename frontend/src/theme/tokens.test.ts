import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/colorScience';
import { UI } from './tokens';

const SURFACES = {
  'bg/app': UI.bgApp,
  'bg/panel': UI.bgPanel,
  'surface/1': UI.surface1,
  'surface/2': UI.surface2,
  'surface/3': UI.surface3,
} as const;

describe('LUMEN text tokens pass WCAG AA on every surface (DESIGN_SYSTEM.md §2.1, §10.1)', () => {
  const TEXT = {
    'text/primary': UI.textPrimary,
    'text/secondary': UI.textSecondary,
    'text/tertiary': UI.textTertiary,
    accent: UI.accent,
  } as const;

  for (const [textName, text] of Object.entries(TEXT)) {
    for (const [surfaceName, surface] of Object.entries(SURFACES)) {
      it(`${textName} on ${surfaceName} ≥ 4.5:1`, () => {
        expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('accent/ink on accent ≥ 4.5:1 (primary button label)', () => {
    expect(contrastRatio(UI.accentInk, UI.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('status colours stay legible on bg/panel', () => {
    expect(contrastRatio(UI.success, UI.bgPanel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI.danger, UI.bgPanel)).toBeGreaterThanOrEqual(4.5);
  });
});
