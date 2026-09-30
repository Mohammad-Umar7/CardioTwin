import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerBoundary } from './LayerBoundary';

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('boom');
  return <p>layer</p>;
}

describe('LayerBoundary', () => {
  it('replaces a failing layer, reports it once, and renders it again after the reset key changes', () => {
    const onError = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <div>
        <p>app</p>
        <LayerBoundary name="tour" resetKey={1} onError={onError}>
          <Boom fail />
        </LayerBoundary>
      </div>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.queryByText('layer')).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    rerender(
      <div>
        <p>app</p>
        <LayerBoundary name="tour" resetKey={2} onError={onError}>
          <Boom fail={false} />
        </LayerBoundary>
      </div>,
    );
    expect(screen.getByText('layer')).toBeInTheDocument();
    spy.mockRestore();
  });
});
