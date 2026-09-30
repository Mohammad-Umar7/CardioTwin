import { describe, expect, it } from 'vitest';
import { toastDuration } from './toastDuration';

describe('toastDuration', () => {
  const undo = { label: 'Undo', onClick: () => {} };

  it('keeps a toast with an action (Undo) for 6 s and a plain message for 4 s', () => {
    expect(toastDuration({ tone: 'success', action: undo })).toBe(6000);
    expect(toastDuration({ tone: 'info' })).toBe(4000);
    expect(toastDuration({ tone: 'warn' })).toBe(4000);
  });

  it('never auto-dismisses a danger toast', () => {
    expect(toastDuration({ tone: 'danger' })).toBeNull();
    expect(toastDuration({ tone: 'danger', action: undo })).toBeNull();
  });
});
