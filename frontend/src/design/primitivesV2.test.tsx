/** V2 primitives (WORKSTATION_V2 §5.4, §9.2 items 4 and 6). */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';
import { Kbd, Shortcut } from './Kbd';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { Probability } from './risk/RiskMarks';
import { StageCard } from './StageCard';
import { Tooltip } from './Tooltip';

afterEach(() => {
  vi.useRealTimers();
});

describe('Probability · data-prob contract', () => {
  it('tags the current estimate with its target', () => {
    const { container } = render(<Probability p={0.98} target="CAD" size="xl" />);
    expect(container.querySelector('[data-prob="CAD"]')).not.toBeNull();
    expect(container.querySelector('[data-baseline]')).toBeNull();
  });

  it('tags a baseline ("was 98 %") as data-baseline so the duplicate probe ignores it', () => {
    const { container } = render(<Probability p={0.98} target="CAD" baseline />);
    expect(container.querySelector('[data-prob]')).toBeNull();
    expect(container.querySelector('[data-baseline="CAD"]')).not.toBeNull();
  });
});

describe('StageCard', () => {
  it('renders the material, the region and an overline header', () => {
    render(
      <StageCard region="risk-card" title="Coronary artery disease" titleId="cad-t" actions={<span>Model estimate</span>}>
        body
      </StageCard>,
    );
    const card = screen.getByText('body').closest('[data-region="risk-card"]');
    expect(card).toHaveClass('stage-card');
    expect(screen.getByRole('heading', { name: 'Coronary artery disease' })).toHaveAttribute('id', 'cad-t');
    expect(screen.getByText('Model estimate')).toBeInTheDocument();
  });

  it('staggers its entrance', () => {
    render(<StageCard enterDelay={60}>x</StageCard>);
    expect(screen.getByText('x')).toHaveStyle({ animationDelay: '60ms' });
  });
});

describe('Kbd and Shortcut', () => {
  it('renders one chip per key', () => {
    render(<Shortcut shortcut="Mod+K" />);
    expect(screen.getAllByText(/^(Ctrl|⌘|K)$/)).toHaveLength(2);
  });

  it('prints alternatives on request', () => {
    const { container } = render(<Shortcut shortcut="0,H" all />);
    expect(container.textContent).toBe('0orH');
  });

  it('is a kbd element', () => {
    render(<Kbd>I</Kbd>);
    expect(screen.getByText('I').tagName).toBe('KBD');
  });
});

describe('Tooltip · close on press (P1-11)', () => {
  it('closes on pointerdown and does not reopen from the focus the press gives, until the pointer re-enters', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Home view · H">
        <button type="button">Home</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Home' });
    fireEvent.mouseEnter(button);
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Home view · H');

    fireEvent.pointerDown(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(button);
    fireEvent.click(button);
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(button);
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('still opens immediately on keyboard focus', () => {
    render(
      <Tooltip content="Explain · E">
        <button type="button">Explain</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Explain' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explain · E');
  });

  it('closes when the trigger is activated from the keyboard', () => {
    render(
      <Tooltip content="Flow · F">
        <button type="button">Flow</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Flow' });
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

function ViewMenu({ onSelect }: { onSelect: (v: string) => void }) {
  const [view, setView] = useState('AP');
  return (
    <Menu
      label="View"
      trigger={(props) => (
        <button type="button" {...props}>
          {view}
        </button>
      )}
    >
      {['AP', 'LAO 45', 'RAO 30'].map((v) => (
        <MenuItem
          key={v}
          type="radio"
          checked={view === v}
          onSelect={() => {
            setView(v);
            onSelect(v);
          }}
        >
          {v}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem shortcut="H" onSelect={() => onSelect('home')}>
        Home view
      </MenuItem>
    </Menu>
  );
}

describe('Menu', () => {
  it('opens on the checked radio item, moves with arrows and selects with Enter', async () => {
    const onSelect = vi.fn();
    render(<ViewMenu onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'AP' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'AP' })).toHaveFocus();
    expect(screen.getByRole('menuitemradio', { name: 'AP' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'LAO 45' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('LAO 45');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'LAO 45' })).toHaveFocus();
  });

  it('Esc closes the menu and returns focus to the trigger; End jumps to the last item', async () => {
    render(<ViewMenu onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'AP' }));
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /Home view/ })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'AP' })).toHaveFocus();
  });
});

function DrawerHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Edit inputs
      </button>
      <Drawer
        open={open}
        side="left"
        label="Edit inputs"
        region="inputs-drawer"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <input aria-label="Find an input" />
      </Drawer>
    </div>
  );
}

describe('Drawer', () => {
  it('is a non-modal dialog that focuses its first field and closes on Esc, returning focus', async () => {
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Edit inputs' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Edit inputs' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(dialog).toHaveAttribute('data-region', 'inputs-drawer');
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Find an input' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(opener).toHaveFocus());
  });

  it('focuses the dialog itself, not its close button, when it has no field', async () => {
    render(
      <Drawer open side="right" label="Explain" onClose={() => undefined}>
        <button type="button">Close · Esc</button>
        <p>Evidence</p>
      </Drawer>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Explain' });
    await vi.waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Close · Esc' })).not.toHaveFocus();
  });
});
