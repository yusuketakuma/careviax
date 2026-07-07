import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CRITICAL_ROUTE_PAYLOAD_BUDGETS,
  resolveRoutePayloadBudget,
} from '../../src/lib/utils/route-payload-budgets';
import { createRequestAbort, parseArgs, runPerfSmoke, runPerfSmokeMatrix } from './perf-smoke';

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

  it('expands the default critical GET payload budget matrix paths', () => {
    const args = parseArgs(['--payload-budget-matrix'], {
      PERF_PATIENT_ID: 'patient_custom_123',
    });

    expect(args.payloadBudgetMatrix).toBe(true);
    expect(args.paths).toEqual(
      expect.arrayContaining([
        '/api/dashboard/cockpit/details',
        '/api/patients/board',
        '/api/patients/patient_custom_123/overview',
        '/api/patients/patient_custom_123/timeline',
        '/api/patients/patient_custom_123/medication-stock',
        '/api/communications/inbound',
        '/api/communications/inbound/signals',
        '/api/care-reports',
      ]),
    );
    expect(args.paths).not.toContain('/api/health');
    expect(args.paths).not.toContain('/api/billing*');
  });

  it('keeps explicit paths when payload budget matrix mode is requested', () => {
    const args = parseArgs(
      ['--payload-budget-matrix', '--path', '/api/patients/board', '--path', '/api/care-reports'],
      {},
    );

    expect(args.payloadBudgetMatrix).toBe(true);
    expect(args.paths).toEqual(['/api/patients/board', '/api/care-reports']);
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
      response_payload_content_length_sample_count: 0,
      response_payload_body_fallback_sample_count: 1,
      response_payload_measurement_status: 'body_fallback',
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
      response_payload_content_length_sample_count: 2,
      response_payload_body_fallback_sample_count: 0,
      response_payload_measurement_status: 'content_length',
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
      response_payload_content_length_sample_count: 0,
      response_payload_body_fallback_sample_count: 1,
      response_payload_measurement_status: 'body_fallback',
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

  it('uses query strings for requests but strips them from smoke output identity', async () => {
    const args = parseArgs(
      [
        '--requests',
        '1',
        '--concurrency',
        '1',
        '--path',
        '/api/care-reports?keyword=%E7%9C%A0%E6%B0%97&patientId=patient_123456#detail',
      ],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(251 * 1024) },
        }),
    );

    const result = await runPerfSmoke(args, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/care-reports?keyword=%E7%9C%A0%E6%B0%97&patientId=patient_123456#detail',
      expect.any(Object),
    );
    expect(result).toMatchObject({
      paths: ['/api/care-reports'],
      response_payload_route_family: 'care-reports-list-search',
      response_payload_budget_bytes: 250 * 1024,
      response_payload_budget_status: 'over_budget',
      target_met: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('keyword=');
    expect(serialized).not.toContain('%E7%9C%A0%E6%B0%97');
    expect(serialized).not.toContain('patientId=');
    expect(serialized).not.toContain('patient_123456');
    expect(serialized).not.toContain('#detail');
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

  it('runs configured payload budget routes as separate matrix entries', async () => {
    const args = parseArgs(
      [
        '--payload-budget-matrix',
        '--requests',
        '1',
        '--concurrency',
        '1',
        '--path',
        '/api/patients/board?status=active',
        '--path',
        '/api/care-reports?keyword=%E7%9C%A0%E6%B0%97',
        '--path',
        '/api/dashboard/cockpit/details?scope=team',
      ],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/dashboard/cockpit/details') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': String(400 * 1024) },
        });
      }
      if (path === '/api/care-reports') {
        return new Response('{}', { status: 200 });
      }
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(120 * 1024) },
      });
    });

    await expect(runPerfSmokeMatrix(args, fetchImpl)).resolves.toMatchObject({
      mode: 'payload_budget_matrix',
      requests_per_path: 1,
      paths: ['/api/patients/board', '/api/care-reports', '/api/dashboard/cockpit/details'],
      summary: {
        route_count: 3,
        configured_payload_budget_count: 3,
        measured_by_content_length_count: 2,
        runtime_unmeasured_route_count: 1,
        over_budget_route_count: 1,
        error_route_count: 0,
      },
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'PAYLOAD_UNMEASURED',
          path: '/api/care-reports',
          family: 'care-reports-list-search',
          budget_route: '/api/care-reports',
        }),
        expect.objectContaining({
          code: 'PAYLOAD_OVER_BUDGET',
          path: '/api/dashboard/cockpit/details',
          family: 'dashboard-details',
          budget_route: '/api/dashboard/cockpit/details',
        }),
      ]),
      target_met: false,
      entries: expect.arrayContaining([
        expect.objectContaining({
          path: '/api/patients/board',
          paths: ['/api/patients/board'],
          budget_route: '/api/patients/board',
          response_payload_route_family: 'patients-board',
          response_payload_budget_status: 'within_budget',
          runtime_payload_measurement_required: true,
          runtime_payload_measurement_met: true,
          target_met: true,
        }),
        expect.objectContaining({
          path: '/api/care-reports',
          paths: ['/api/care-reports'],
          budget_route: '/api/care-reports',
          response_payload_route_family: 'care-reports-list-search',
          response_payload_measurement_status: 'body_fallback',
          runtime_payload_measurement_required: true,
          runtime_payload_measurement_met: false,
          target_met: false,
        }),
        expect.objectContaining({
          path: '/api/dashboard/cockpit/details',
          paths: ['/api/dashboard/cockpit/details'],
          budget_route: '/api/dashboard/cockpit/details',
          response_payload_route_family: 'dashboard-details',
          response_payload_budget_status: 'over_budget',
          response_payload_budget_met: false,
          runtime_payload_measurement_required: true,
          runtime_payload_measurement_met: true,
          target_met: false,
        }),
      ]),
    });
  });

  it('does not hide mixed configured budget overruns in matrix mode', async () => {
    const args = parseArgs(
      [
        '--payload-budget-matrix',
        '--requests',
        '1',
        '--concurrency',
        '1',
        '--path',
        '/api/dashboard/cockpit/summary',
        '--path',
        '/api/patients/board',
      ],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      const contentLength = path === '/api/dashboard/cockpit/summary' ? 60_000 : 1024;
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(contentLength) },
      });
    });

    await expect(runPerfSmokeMatrix(args, fetchImpl)).resolves.toMatchObject({
      summary: {
        route_count: 2,
        configured_payload_budget_count: 2,
        over_budget_route_count: 1,
        runtime_unmeasured_route_count: 0,
      },
      target_met: false,
      entries: expect.arrayContaining([
        expect.objectContaining({
          path: '/api/dashboard/cockpit/summary',
          response_payload_route_family: 'dashboard-summary',
          response_payload_budget_bytes: 50 * 1024,
          p95_response_payload_bytes: 60_000,
          response_payload_budget_status: 'over_budget',
          response_payload_budget_met: false,
          response_payload_budget_over_count: 1,
          target_met: false,
        }),
        expect.objectContaining({
          path: '/api/patients/board',
          response_payload_route_family: 'patients-board',
          response_payload_budget_bytes: 300 * 1024,
          response_payload_budget_status: 'within_budget',
          target_met: true,
        }),
      ]),
    });
  });

  it('marks configured payload budget matrix entries as runtime-unmeasured without content-length', async () => {
    const args = parseArgs(
      [
        '--payload-budget-matrix',
        '--requests',
        '1',
        '--concurrency',
        '1',
        '--path',
        '/api/patients/board',
      ],
      {},
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));

    await expect(runPerfSmokeMatrix(args, fetchImpl)).resolves.toMatchObject({
      summary: {
        route_count: 1,
        configured_payload_budget_count: 1,
        measured_by_content_length_count: 0,
        runtime_unmeasured_route_count: 1,
        over_budget_route_count: 0,
      },
      warnings: [
        {
          code: 'PAYLOAD_UNMEASURED',
          path: '/api/patients/board',
          family: 'patients-board',
          budget_route: '/api/patients/board',
        },
      ],
      target_met: false,
      entries: [
        expect.objectContaining({
          path: '/api/patients/board',
          response_payload_measurement_status: 'body_fallback',
          response_payload_budget_status: 'within_budget',
          runtime_payload_measurement_required: true,
          runtime_payload_measurement_met: false,
          target_met: false,
        }),
      ],
    });
  });

  it('default payload budget matrix paths cover every configured GET budget route', () => {
    const args = parseArgs(['--payload-budget-matrix'], {
      PERF_PATIENT_ID: 'patient_test_001',
    });
    const configuredGetBudgets = CRITICAL_ROUTE_PAYLOAD_BUDGETS.filter(
      (definition) =>
        definition.method === 'GET' &&
        definition.budget_bytes != null &&
        !definition.route.endsWith('*'),
    );

    expect(args.paths).toHaveLength(configuredGetBudgets.length);
    expect(new Set(args.paths).size).toBe(args.paths.length);
    expect(JSON.stringify(args.paths)).not.toContain(':id');
    expect(JSON.stringify(args.paths)).not.toContain('org_');

    for (const path of args.paths) {
      const resolved = resolveRoutePayloadBudget('GET', path);
      expect(resolved).not.toBeNull();
      expect(resolved?.budget_bytes).not.toBeNull();
      expect(resolved?.route.endsWith('*')).toBe(false);
    }

    expect(
      new Set(args.paths.map((path) => resolveRoutePayloadBudget('GET', path)?.family)),
    ).toEqual(new Set(configuredGetBudgets.map((definition) => definition.family)));
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
