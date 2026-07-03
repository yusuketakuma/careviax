import { describe, expect, it, vi } from 'vitest';
import { createSonnerToastMock, SONNER_TOAST_MOCK_METHODS } from './sonner-test-utils';

describe('createSonnerToastMock', () => {
  it('returns a sonner-compatible module with stable toast identity', () => {
    const harness = createSonnerToastMock();

    expect(harness.module).toEqual({ toast: harness.toast });
    expect(vi.isMockFunction(harness.toast)).toBe(true);
    for (const method of SONNER_TOAST_MOCK_METHODS) {
      expect(vi.isMockFunction(harness.toast[method])).toBe(true);
    }
  });

  it('clears call history for the callable toast and all methods', () => {
    const harness = createSonnerToastMock();

    harness.toast('default');
    for (const method of SONNER_TOAST_MOCK_METHODS) {
      harness.toast[method]('message');
    }

    harness.clear();

    expect(harness.toast).not.toHaveBeenCalled();
    for (const method of SONNER_TOAST_MOCK_METHODS) {
      expect(harness.toast[method]).not.toHaveBeenCalled();
    }
  });

  it('resets call history while restoring default return values', () => {
    const harness = createSonnerToastMock();

    harness.toast.error.mockReturnValueOnce('custom-id');
    expect(harness.toast.error('message')).toBe('custom-id');

    harness.reset();

    expect(harness.toast.error).not.toHaveBeenCalled();
    expect(harness.toast.error('message')).toBe('toast-id');
    expect(harness.toast.getHistory()).toEqual([]);
    expect(harness.toast.getToasts()).toEqual([]);
    expect(harness.toast.promise(Promise.resolve('ok'))).toHaveProperty('unwrap');
  });
});
