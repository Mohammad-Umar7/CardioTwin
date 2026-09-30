import { act, render, screen } from '@testing-library/react';
import { AnimatePresence } from 'framer-motion';
import { describe, expect, it } from 'vitest';
import { Drawer } from './Drawer';
import { ExitInert } from './ExitInert';

function Harness({ open }: { open: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <ExitInert key="panel" data-testid="panel" exit={{ opacity: 0, transition: { duration: 10 } }}>
          <button type="button">Inside</button>
        </ExitInert>
      )}
    </AnimatePresence>
  );
}

describe('ExitInert', () => {
  it('is interactive while present, and inert and hidden as soon as its exit starts', () => {
    const { rerender } = render(<Harness open />);
    const panel = screen.getByTestId('panel');
    expect(panel.inert).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBeNull();
    act(() => rerender(<Harness open={false} />));
    const leaving = screen.queryByTestId('panel');
    // Either already gone, or still animating out: never tabbable or read out meanwhile.
    if (leaving) {
      expect(leaving.inert).toBe(true);
      expect(leaving.getAttribute('aria-hidden')).toBe('true');
      expect(leaving.hasAttribute('data-exiting')).toBe(true);
    }
  });

  it('makes a closing drawer inert (no dead, invisible controls after Esc)', () => {
    const { rerender } = render(
      <Drawer open side="right" onClose={() => {}} label="Explain" region="explain-drawer">
        <button type="button">Tab</button>
      </Drawer>,
    );
    const drawer = document.querySelector<HTMLElement>('[data-region="explain-drawer"]')!;
    expect(drawer.inert).toBe(false);
    act(() =>
      rerender(
        <Drawer open={false} side="right" onClose={() => {}} label="Explain" region="explain-drawer">
          <button type="button">Tab</button>
        </Drawer>,
      ),
    );
    const closed = document.querySelector<HTMLElement>('[data-region="explain-drawer"]');
    expect(closed === null || closed.inert).toBe(true);
  });
});
