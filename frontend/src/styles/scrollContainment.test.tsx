/**
 * P0-1 regression (WORKSTATION_V2 §5.4 "Scroll containers", §9.2 item 1).
 *
 * The bug: an absolutely positioned focusable (an sr-only input, a toggle's hidden checkbox) inside a
 * scroll area without `position: relative` resolved its containing block against a clipping ancestor
 * with `overflow: hidden`. Such an ancestor is still programmatically scrollable, so focusing the field
 * scrolled it and shifted the whole workstation. The rules that make this impossible:
 *   1. every `.panel-scroll` is `position: relative` (absolute descendants stay inside it);
 *   2. clipping ancestors of focusable content use `overflow: clip`, which is not scrollable at all.
 * jsdom does not scroll on focus, so rule 1 is checked on the stylesheet and rule 2 on the rendered DOM
 * (`findScrollTraps`), including the "focusing a field never changes scrollTop" invariant for good measure.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccordionItem } from '@/design/Accordion';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, 'globals.css'), 'utf8');

/** Body of the first CSS rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!match) throw new Error(`no CSS rule for ${selector}`);
  return match[2]!;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Elements that clip with `overflow: hidden` (Tailwind `overflow-hidden`, `overflow-y-hidden`, or an
 * inline style) AND contain focusable content: each one is a latent P0-1 scroll trap.
 */
function findScrollTraps(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('*')].filter((el) => {
    const hiddenClass = [...el.classList].some((c) => /^overflow(-[xy])?-hidden$/.test(c));
    const hiddenStyle = /overflow(-[xy])?:\s*hidden/.test(el.getAttribute('style') ?? '');
    return (hiddenClass || hiddenStyle) && el.querySelector(FOCUSABLE) !== null;
  });
}

describe('P0-1 · scroll containment', () => {
  it('.panel-scroll is its own containing block', () => {
    const body = ruleBody('.panel-scroll');
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it('the stage-card material clips with overflow: clip, never hidden', () => {
    const body = ruleBody('.stage-card');
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/overflow:\s*clip/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
  });

  it('an accordion inside a scroll area has no hidden-overflow ancestor around its fields', () => {
    const { container } = render(
      <div className="panel-scroll" style={{ height: 200 }}>
        <AccordionItem header="Symptoms" open onToggle={() => {}}>
          <label>
            Typical angina <input className="sr-only" type="checkbox" />
          </label>
        </AccordionItem>
      </div>,
    );
    expect(findScrollTraps(container)).toEqual([]);
  });

  it('focusing a field never changes scrollTop on a non-scrolling ancestor', () => {
    const { container, getByRole } = render(
      <div data-testid="grid" className="relative grid overflow-clip">
        <div className="panel-scroll">
          <input aria-label="Ejection fraction" className="sr-only" />
        </div>
      </div>,
    );
    const grid = container.firstElementChild as HTMLElement;
    const before = grid.scrollTop;
    getByRole('textbox', { name: 'Ejection fraction' }).focus();
    expect(grid.scrollTop).toBe(before);
    expect(findScrollTraps(container)).toEqual([]);
  });

  it('detects a trap when one is introduced', () => {
    const { container } = render(
      <div className="overflow-hidden">
        <button type="button">x</button>
      </div>,
    );
    expect(findScrollTraps(container)).toHaveLength(1);
  });
});
