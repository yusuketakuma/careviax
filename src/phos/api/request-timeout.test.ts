import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhosRequestAbort } from './request-timeout';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createPhosRequestAbort', () => {
  it('aborts with the configured timeout reason and marks timeout origin', () => {
    vi.useFakeTimers();
    const reason = new Error('PHOS_API_REQUEST_TIMEOUT');

    const abort = createPhosRequestAbort({ timeoutMs: 100, timeoutReason: reason });

    expect(abort.didTimeout()).toBe(false);
    vi.advanceTimersByTime(100);

    expect(abort.signal.aborted).toBe(true);
    expect(abort.signal.reason).toBe(reason);
    expect(abort.didTimeout()).toBe(true);
    abort.clear();
  });

  it('propagates caller aborts without marking timeout origin', () => {
    const caller = new AbortController();
    const abort = createPhosRequestAbort({
      timeoutMs: 1000,
      timeoutReason: new Error('PHOS_API_REQUEST_TIMEOUT'),
      callerSignal: caller.signal,
    });

    caller.abort(new Error('CALLER_ABORTED'));

    expect(abort.signal.aborted).toBe(true);
    expect((abort.signal.reason as Error).message).toBe('CALLER_ABORTED');
    expect(abort.didTimeout()).toBe(false);
    abort.clear();
  });

  it('unrefs and clears the timeout handle', () => {
    const timeoutHandle = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeoutHandle);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);

    const abort = createPhosRequestAbort({
      timeoutMs: 250,
      timeoutReason: new Error('PHOS_API_REQUEST_TIMEOUT'),
    });
    abort.clear();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(timeoutHandle.unref).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });
});
