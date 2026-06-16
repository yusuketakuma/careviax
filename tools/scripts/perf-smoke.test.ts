import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestAbort, parseArgs, runPerfSmoke } from './perf-smoke';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('perf-smoke parseArgs', () => {
  it('uses bounded defaults for malformed numeric environment values', () => {
    const args = parseArgs([], {
      PERF_REQUESTS: 'NaN',
      PERF_CONCURRENCY: 'Infinity',
      PERF_TARGET_MS: '0',
    });

    expect(args.requests).toBe(40);
    expect(args.concurrency).toBe(4);
    expect(args.targetMs).toBe(500);
    expect(args.requestTimeoutMs).toBe(10_000);
  });

  it('normalizes numeric CLI overrides before running workers', () => {
    const args = parseArgs(
      [
        '--requests',
        '1000000',
        '--concurrency',
        '12.8',
        '--target-ms',
        '250.9',
        '--request-timeout-ms',
        '120001',
        '--method',
        'post',
        '--body',
        '{"items":[]}',
        '--path',
        '/api/patients',
        '--path',
        '/api/patients',
        '--header',
        'Authorization: Bearer test-token',
      ],
      {},
    );

    expect(args).toMatchObject({
      requests: 10_000,
      concurrency: 12,
      targetMs: 250,
      requestTimeoutMs: 120_000,
      method: 'POST',
      paths: ['/api/patients'],
      body: '{"items":[]}',
      headers: {
        Authorization: 'Bearer test-token',
      },
    });
  });

  it('falls back per CLI option when a numeric override is invalid', () => {
    const args = parseArgs(
      ['--requests', '-1', '--concurrency', 'abc', '--target-ms', 'Infinity'],
      {
        PERF_REQUESTS: '5',
        PERF_CONCURRENCY: '6',
        PERF_TARGET_MS: '700',
      },
    );

    expect(args.requests).toBe(40);
    expect(args.concurrency).toBe(4);
    expect(args.targetMs).toBe(500);
  });

  it('aborts stalled requests and records them as timeout errors', async () => {
    vi.useFakeTimers();
    const args = parseArgs(
      ['--requests', '1', '--concurrency', '1', '--request-timeout-ms', '5', '--target-ms', '10'],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    const result = runPerfSmoke(args, fetchImpl);
    await vi.advanceTimersByTimeAsync(5);

    await expect(result).resolves.toMatchObject({
      requests: 1,
      error_count: 1,
      timeout_count: 1,
      target_met: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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
    expect(abort.didTimeout()).toBe(false);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('clears request timeout timers after successful requests', async () => {
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);
    const args = parseArgs(
      ['--requests', '1', '--concurrency', '1', '--request-timeout-ms', '1234'],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));

    await expect(runPerfSmoke(args, fetchImpl)).resolves.toMatchObject({
      requests: 1,
      error_count: 0,
      timeout_count: 0,
      target_met: true,
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('sends POST bodies with a default JSON content type', async () => {
    const args = parseArgs(
      [
        '--requests',
        '1',
        '--concurrency',
        '1',
        '--method',
        'POST',
        '--path',
        '/api/visit-schedule-proposals/billing-preview-batch',
        '--body',
        '{"items":[{"key":"proposal_1"}]}',
      ],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));

    await expect(runPerfSmoke(args, fetchImpl)).resolves.toMatchObject({
      requests: 1,
      method: 'POST',
      body_bytes: 32,
      error_count: 0,
      target_met: true,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/visit-schedule-proposals/billing-preview-batch',
      expect.objectContaining({
        method: 'POST',
        body: '{"items":[{"key":"proposal_1"}]}',
        headers: expect.objectContaining({
          'content-type': 'application/json',
        }),
      }),
    );
  });
});
