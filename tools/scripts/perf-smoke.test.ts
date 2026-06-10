import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, runPerfSmoke } from './perf-smoke';

afterEach(() => {
  vi.useRealTimers();
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
});
