import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Collapse } from './Collapse';

const wrapper = () => screen.getByText('Narrative').closest('[data-collapse]') as HTMLElement;

describe('Collapse', () => {
  it('keeps its content mounted and takes it out of the tab order and the accessibility tree while closed', () => {
    const view = render(<Collapse show>Narrative</Collapse>);
    expect(wrapper()).toHaveAttribute('data-collapse', 'open');
    expect(wrapper()).not.toHaveAttribute('aria-hidden');
    expect(wrapper().inert).toBe(false);

    view.rerender(<Collapse show={false}>Narrative</Collapse>);
    expect(wrapper()).toHaveAttribute('data-collapse', 'closed');
    expect(wrapper()).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper().inert).toBe(true);
  });

  it('comes straight back when re-shown mid-collapse (the same node, open, never left at opacity 0)', () => {
    const view = render(<Collapse show>Narrative</Collapse>);
    const node = wrapper();
    view.rerender(<Collapse show={false}>Narrative</Collapse>);
    view.rerender(<Collapse show>Narrative</Collapse>);
    expect(wrapper()).toBe(node);
    expect(node).toHaveAttribute('data-collapse', 'open');
    expect(node.inert).toBe(false);
  });
});
