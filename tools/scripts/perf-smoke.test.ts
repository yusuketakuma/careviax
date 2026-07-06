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
    expect(args.p99TargetMs).toBe(1000);
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
        '--p99-target-ms',
        '950.9',
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
      p99TargetMs: 950,
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
      response_payload_sample_count: 1,
      p95_response_payload_bytes: 2,
      response_payload_budget_status: 'unconfigured',
      p95_target_met: true,
      p99_target_met: true,
      target_met: true,
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('records response payload bytes from content-length and fails configured budget overruns', async () => {
    const args = parseArgs(
      ['--requests', '2', '--concurrency', '1', '--path', '/api/patients/board'],
      {},
    );
    const payloads = [310_000, 330_000];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const payload = payloads.shift() ?? 0;
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(payload) },
      });
    });

    await expect(runPerfSmoke(args, fetchImpl)).resolves.toMatchObject({
      requests: 2,
      response_payload_sample_count: 2,
      average_response_payload_bytes: 320_000,
      p50_response_payload_bytes: 310_000,
      p95_response_payload_bytes: 330_000,
      max_response_payload_bytes: 330_000,
      response_payload_route_family: 'patients-board',
      response_payload_budget_bytes: 307_200,
      response_payload_budget_status: 'over_budget',
      response_payload_budget_met: false,
      response_payload_budget_over_count: 2,
      p99_target_met: true,
      target_met: false,
    });
  });

  it('fails the release gate when p99 exceeds its configured target', async () => {
    const nowSpy = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1500);
    const args = parseArgs(
      ['--requests', '2', '--concurrency', '1', '--target-ms', '2000', '--p99-target-ms', '1000'],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));

    await expect(runPerfSmoke(args, fetchImpl)).resolves.toMatchObject({
      p95_ms: 1500,
      p99_ms: 1500,
      p95_target_met: true,
      p99_target_met: false,
      target_met: false,
    });
    expect(nowSpy).toHaveBeenCalled();
  });

  it('falls back to response body byte length when content-length is absent', async () => {
    const args = parseArgs(['--requests', '1', '--concurrency', '1'], {});
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('abcd', { status: 200 }));

    await expect(runPerfSmoke(args, fetchImpl)).resolves.toMatchObject({
      requests: 1,
      response_payload_sample_count: 1,
      average_response_payload_bytes: 4,
      p50_response_payload_bytes: 4,
      p95_response_payload_bytes: 4,
      max_response_payload_bytes: 4,
      response_payload_route_family: null,
      response_payload_budget_bytes: null,
      response_payload_budget_status: 'unconfigured',
      response_payload_budget_met: null,
      response_payload_budget_over_count: 0,
      target_met: true,
    });
  });

  it('does not fail response payload budgets for unconfigured critical route families', async () => {
    const args = parseArgs(
      ['--requests', '1', '--concurrency', '1', '--path', '/api/billing/close-board?month=2026-07'],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200, headers: { 'content-length': '500000' } }),
    );

    await expect(runPerfSmoke(args, fetchImpl)).resolves.toMatchObject({
      response_payload_route_family: 'billing',
      response_payload_budget_bytes: null,
      response_payload_budget_status: 'unconfigured',
      response_payload_budget_met: null,
      target_met: true,
    });
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
