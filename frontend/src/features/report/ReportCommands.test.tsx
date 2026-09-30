import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCommands, useCommandStore } from '@/state/commandStore';
import { usePatientStore } from '@/state/patientStore';
import { ReportCommands } from './ReportCommands';
import { REPORT_CMD, REPORT_PATH } from './useReportCommands';

let location = '';
function Where() {
  location = useLocation().pathname;
  return null;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportCommands />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const command = (id: string) => resolveCommands(useCommandStore.getState().sources).find((c) => c.id === id);

describe('ReportCommands', () => {
  afterEach(() => {
    usePatientStore.setState({ features: {}, status: 'idle' });
  });

  it('registers "Open printable report" and navigates to the report route', () => {
    usePatientStore.setState({ features: { Age: 58 }, status: 'ready' });
    const view = mount('/workstation');
    const open = command(REPORT_CMD.open)!;
    expect(open.title).toBe('Open printable report');
    expect(open.group).toBe('pages');
    expect(open.when?.()).toBe(true);
    act(() => open.run());
    expect(location).toBe(REPORT_PATH);
    view.unmount();
    expect(command(REPORT_CMD.open)).toBeUndefined();
  });

  it('hides "Open" until a patient is loaded', () => {
    const view = mount('/');
    expect(command(REPORT_CMD.open)!.when?.()).toBe(false);
    view.unmount();
  });

  it('offers printing only on the report page once the estimate is current', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    usePatientStore.setState({ features: { Age: 58 }, status: 'loading' });
    const view = mount(REPORT_PATH);
    expect(command(REPORT_CMD.open)!.when?.()).toBe(false);
    expect(command(REPORT_CMD.print)!.when?.()).toBe(false);
    act(() => usePatientStore.setState({ status: 'ready' }));
    expect(command(REPORT_CMD.print)!.when?.()).toBe(true);
    command(REPORT_CMD.print)!.run();
    expect(print).toHaveBeenCalledOnce();
    view.unmount();
  });
});
