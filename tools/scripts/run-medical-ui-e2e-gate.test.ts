import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestAbort, waitForApp } from './run-medical-ui-e2e-gate';

describe('run medical UI E2E gate helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates unrefed request abort timers that can be cleared', () => {
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    const abort = createRequestAbort(1234);
    abort.clear();

    expect(abort.signal).toEqual(expect.any(AbortSignal));
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('passes a bounded abort signal to readiness fetches and clears it after success', async () => {
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));

    await waitForApp({
      appOrigin: 'http://localhost:3012',
      readyCheckTimeoutMs: 4567,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3012',
      expect.objectContaining({
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 4567);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('fails immediately when the app process exits before readiness', async () => {
    await expect(
      waitForApp({
        appOrigin: 'http://localhost:3012',
        startupTimeoutMs: 100,
        fetchImpl: vi.fn(),
        isAppExited: () => true,
      }),
    ).rejects.toThrow('E2E app server exited before it became ready');
  });

  it('times out while polling readiness without depending on real timers', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);

    await expect(
      waitForApp({
        appOrigin: 'http://localhost:3012',
        startupTimeoutMs: 50,
        pollIntervalMs: 1,
        readyCheckTimeoutMs: 1,
        fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
        sleepMs: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('Timed out waiting for http://localhost:3012');
  });
});
