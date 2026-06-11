import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchTimeout } from './fetch-timeout';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createFetchTimeout', () => {
  it('aborts with the provided reason', () => {
    vi.useFakeTimers();
    const reason = new Error('REQUEST_TIMEOUT');

    const timeout = createFetchTimeout(100, reason);
    vi.advanceTimersByTime(100);

    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.signal.reason).toBe(reason);
    timeout.clear();
  });

  it('unrefs and clears the timeout handle', () => {
    const timeoutHandle = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeoutHandle);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);

    const timeout = createFetchTimeout(250);
    timeout.clear();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(timeoutHandle.unref).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });
});
