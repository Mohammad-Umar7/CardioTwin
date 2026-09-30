import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { THIN_SPACE } from '@/lib/format';
import { AccordionItem } from './Accordion';
import { Button } from './Button';
import { Modal } from './Modal';
import { BandChip, Probability, RiskTrack } from './risk/RiskMarks';
import { SegmentedControl } from './SegmentedControl';
import { Slider } from './Slider';
import { Tabs } from './Tabs';

describe('risk marks', () => {
  it('shows the band word in text, never colour alone', () => {
    render(<BandChip band="critical" />);
    expect(screen.getByText('Very high')).toBeInTheDocument();
  });

  it('renders pending chips as "Updating"', () => {
    render(<BandChip band="high" pending />);
    expect(screen.getByText('Updating')).toBeInTheDocument();
  });

  it('formats probabilities with a spoken equivalent and the exact value in the title', () => {
    render(<Probability p={0.719} />);
    expect(screen.getByText('72 percent')).toHaveClass('sr-only');
    expect(screen.getByTitle('p = 0.719')).toBeInTheDocument();
  });

  it('labels the threshold on the track', () => {
    const { container } = render(<RiskTrack p={0.6} threshold={0.46} showThresholdLabel />);
    expect(container.textContent).toContain(`thr 46${THIN_SPACE}%`);
  });
});

describe('controls', () => {
  it('SegmentedControl is a radiogroup with arrow-key selection', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Sex"
        value="Male"
        onChange={onChange}
        options={[
          { value: 'Male', label: 'Male' },
          { value: 'Female', label: 'Female' },
        ]}
      />,
    );
    const male = screen.getByRole('radio', { name: 'Male' });
    expect(male).toHaveAttribute('aria-checked', 'true');
    male.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('Female');
  });

  it('Slider exposes aria-valuetext and moves ×10 steps on PageUp', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <Slider
        label="Ejection fraction"
        value={45}
        min={15}
        max={60}
        step={1}
        onChange={onChange}
        onCommit={onCommit}
        valueText="Ejection fraction 45 percent, below normal range 50 to 70"
        normal={{ low: 50, high: 70 }}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Ejection fraction' });
    expect(slider).toHaveAttribute('aria-valuetext', 'Ejection fraction 45 percent, below normal range 50 to 70');
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange).toHaveBeenCalledWith(55);
    expect(onCommit).toHaveBeenCalledWith(55);
  });

  it('Tabs link tabs to panels and support arrow keys', async () => {
    function Harness() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <Tabs
          idBase="t"
          label="Targets"
          value={v}
          onChange={(next) => setV(next as 'a' | 'b')}
          items={[
            { value: 'a', label: 'CAD' },
            { value: 'b', label: 'LAD' },
          ]}
        />
      );
    }
    render(<Harness />);
    const cad = screen.getByRole('tab', { name: 'CAD' });
    expect(cad).toHaveAttribute('aria-controls', 't-panel-a');
    cad.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'LAD' })).toHaveAttribute('aria-selected', 'true');
  });

  it('AccordionItem toggles aria-expanded', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <AccordionItem open={open} onToggle={() => setOpen((o) => !o)} header="Exam">
          <p>content</p>
        </AccordionItem>
      );
    }
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Exam' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('Button in loading state is busy and disabled', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Modal closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Details">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
