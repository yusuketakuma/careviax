import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTenantContext } from './lambda-handler';
import { createInMemoryObservabilitySink, hashTenantId } from './observability';

const validEvent = {
  routeKey: 'GET /cards',
  requestContext: {
    requestId: 'req_1',
    authorizer: {
      jwt: {
        claims: {
          token_use: 'access',
          tenant_id: 'tenant_abc123',
          sub: 'user_001',
          role: 'PHARMACIST',
          scope: 'phos/cards.read',
        },
      },
    },
  },
};

describe('withTenantContext', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes TenantContext to the wrapped handler', async () => {
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(
      async ({ ctx }) => ({
        request_id: ctx.request_id,
        tenant_id: ctx.tenant_id,
        user_id: ctx.user_id,
      }),
      { observability },
    );

    const response = await handler(validEvent);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
    });
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'RequestLatencyMs',
        route_key: 'GET /cards',
        tenant_id: 'tenant_abc123',
      }),
    );
    expect(observability.annotations).toContainEqual(
      expect.objectContaining({
        route_key: 'GET /cards',
        tenant_id_hash: hashTenantId('tenant_abc123'),
        tenant_id: 'tenant_abc123',
        user_id: 'user_001',
        request_id: 'req_1',
      }),
    );
  });

  it('rejects legacy REST proxy authorizer claims outside the HTTP API JWT authorizer shape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withTenantContext(async ({ ctx }) => ({
      request_id: ctx.request_id,
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
    }));

    const response = await handler({
      resource: '/cards/{card_id}',
      httpMethod: 'GET',
      requestContext: {
        requestId: 'req_rest_1',
        authorizer: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_001',
            role: 'PHARMACIST',
            scope: 'phos/cards.read',
          },
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      request_id: 'req_rest_1',
      error_code: 'TENANT_CONTEXT_MISSING',
    });
  });

  it('emits success EMF logs with tenant, user, request, and correlation fields', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = withTenantContext(async () => ({ ok: true }), {
      now: vi
        .fn()
        .mockReturnValueOnce(new Date('2026-06-09T00:00:00.000Z'))
        .mockReturnValueOnce(new Date('2026-06-09T00:00:00.017Z')),
    });

    const response = await handler({
      ...validEvent,
      headers: { 'x-correlation-id': 'corr_1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['X-Request-Id']).toBe('req_1');
    const metric = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.RequestLatencyMs === 17);
    expect(metric).toMatchObject({
      route_key: 'GET /cards',
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      RequestLatencyMs: 17,
    });
    const completed = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.message === 'PH-OS lambda request completed');
    expect(completed).toMatchObject({
      level: 'INFO',
      message: 'PH-OS lambda request completed',
      result: 'SUCCESS',
      status_code: 200,
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      route_key: 'GET /cards',
      latency_ms: 17,
    });
  });

  it('replaces unsafe correlation header values before logs and EMF are emitted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = withTenantContext(async ({ ctx }) => ({
      request_id: ctx.request_id,
      correlation_id: ctx.correlation_id,
    }));

    const response = await handler({
      ...validEvent,
      headers: { 'x-correlation-id': 'patient=山田 drug=secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      correlation_id: 'req_1',
    });
    const completed = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.message === 'PH-OS lambda request completed');
    expect(completed).toMatchObject({
      request_id: 'req_1',
      correlation_id: 'req_1',
    });
    expect(JSON.stringify(completed)).not.toContain('山田');
  });

  it('emits tenant-attributed EMF logs for valid-JWT tenant boundary rejections', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = withTenantContext(async () => ({}));

    const response = await handler({
      ...validEvent,
      headers: { 'x-correlation-id': 'corr_1' },
      body: JSON.stringify({ tenant_id: 'tenant_other' }),
    });

    expect(response.statusCode).toBe(400);
    const metrics = logSpy.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: 'tenant_abc123',
          user_id: 'user_001',
          request_id: 'req_1',
          correlation_id: 'corr_1',
          TenantBoundaryRejectedCount: 1,
        }),
        expect.objectContaining({
          tenant_id: 'tenant_abc123',
          user_id: 'user_001',
          request_id: 'req_1',
          correlation_id: 'corr_1',
          CrossTenantAttemptCount: 1,
        }),
      ]),
    );
  });

  it('rejects tenant_id in body before handler execution', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observability = createInMemoryObservabilitySink();
    let called = false;
    const handler = withTenantContext(
      async () => {
        called = true;
        return {};
      },
      { observability },
    );

    const response = await handler({
      ...validEvent,
      body: JSON.stringify({ tenant_id: 'tenant_other' }),
    });

    expect(called).toBe(false);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      message_key: 'api.error.tenant_id_in_payload_forbidden',
      details: { source: 'body' },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        level: 'ERROR',
        message: 'PH-OS lambda boundary failed',
        result: 'ERROR',
        status_code: 400,
        tenant_id: 'tenant_abc123',
        user_id: 'user_001',
        request_id: 'req_1',
        correlation_id: 'req_1',
        route_key: 'GET /cards',
        error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        details: { source: 'body' },
      }),
    );
    expect(observability.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'TenantBoundaryRejectedCount',
          route_key: 'GET /cards',
          tenant_id: 'tenant_abc123',
          user_id: 'user_001',
          error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        }),
        expect.objectContaining({
          name: 'CrossTenantAttemptCount',
          route_key: 'GET /cards',
          tenant_id: 'tenant_abc123',
          user_id: 'user_001',
          error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        }),
      ]),
    );
    expect(observability.security_events).toContainEqual(
      expect.objectContaining({
        event_type: 'TENANT_BOUNDARY_REJECTED',
        tenant_id: 'tenant_abc123',
        user_id: 'user_001',
        request_id: 'req_1',
        route_key: 'GET /cards',
        error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        details: { source: 'body' },
      }),
    );
  });

  it('rejects tenant_id in REST multi-value query parameters before handler execution', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let called = false;
    const handler = withTenantContext(async () => {
      called = true;
      return {};
    });

    const response = await handler({
      ...validEvent,
      queryStringParameters: null,
      multiValueQueryStringParameters: {
        tenant_id: ['tenant_other'],
      },
    });

    expect(called).toBe(false);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      message_key: 'api.error.tenant_id_in_payload_forbidden',
      details: { source: 'query' },
    });
  });

  it('flushes boundary observability before returning tenant boundary errors', async () => {
    const calls: string[] = [];
    const observability = {
      metrics: [],
      annotations: [],
      security_events: [],
      emitMetric: vi.fn(),
      annotateTrace: vi.fn(),
      recordSecurityEvent: vi.fn(() => {
        calls.push('recordSecurityEvent');
      }),
      flush: vi.fn(async () => {
        calls.push('flush');
      }),
    };
    const handler = withTenantContext(async () => ({}), { observability });

    const response = await handler({
      ...validEvent,
      body: JSON.stringify({ tenant_id: 'tenant_other' }),
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual(['recordSecurityEvent', 'flush']);
    expect(observability.flush).toHaveBeenCalledOnce();
  });

  it('flushes observability before returning handler-produced Lambda responses', async () => {
    const calls: string[] = [];
    const observability = {
      metrics: [],
      annotations: [],
      security_events: [],
      emitMetric: vi.fn(),
      annotateTrace: vi.fn(),
      recordSecurityEvent: vi.fn(() => {
        calls.push('recordSecurityEvent');
      }),
      flush: vi.fn(async () => {
        calls.push('flush');
      }),
    };
    const handler = withTenantContext(
      async ({ ctx }) => {
        ctx.observability?.recordSecurityEvent({
          event_type: 'AUTHORIZATION_DENIED',
          severity: 'WARNING',
          tenant_id: ctx.tenant_id,
          user_id: ctx.user_id,
          request_id: ctx.request_id,
          correlation_id: ctx.correlation_id,
          route_key: 'GET /cards',
          error_code: 'FORBIDDEN',
          details: { missing_scopes: ['phos/cards.read'] },
        });
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: ctx.request_id,
            error_code: 'FORBIDDEN',
            message_key: 'api.error.forbidden',
          }),
        };
      },
      { observability },
    );

    const response = await handler(validEvent);

    expect(response.statusCode).toBe(403);
    expect(response.headers['X-Request-Id']).toBe('req_1');
    expect(calls).toEqual(['recordSecurityEvent', 'flush']);
    expect(observability.flush).toHaveBeenCalledOnce();
  });

  it('logs handler-produced error responses with result and status metadata', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withTenantContext(async ({ ctx }) => ({
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: ctx.request_id,
        error_code: 'FORBIDDEN',
        message_key: 'api.error.forbidden',
      }),
    }));

    const response = await handler(validEvent);

    expect(response.statusCode).toBe(403);
    const completed = errorSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.message === 'PH-OS lambda request completed');
    expect(completed).toMatchObject({
      level: 'ERROR',
      message: 'PH-OS lambda request completed',
      result: 'ERROR',
      status_code: 403,
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'req_1',
      route_key: 'GET /cards',
      error_code: 'FORBIDDEN',
    });
  });

  it('logs observability flush failures with safe correlation fields', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observability = {
      metrics: [],
      annotations: [],
      security_events: [],
      emitMetric: vi.fn(),
      annotateTrace: vi.fn(),
      recordSecurityEvent: vi.fn(),
      flush: vi.fn(async () => {
        throw new Error('flush failed');
      }),
    };
    const handler = withTenantContext(async () => ({ ok: true }), { observability });

    const response = await handler(validEvent);

    expect(response.statusCode).toBe(200);
    const flushFailure = errorSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.type === 'PHOS_OBSERVABILITY_FLUSH_FAILED');
    expect(flushFailure).toMatchObject({
      type: 'PHOS_OBSERVABILITY_FLUSH_FAILED',
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'req_1',
      route_key: 'GET /cards',
      error: 'flush failed',
    });
  });

  it('returns a timeout response before the Lambda hard deadline is exhausted', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(
      async () =>
        new Promise(() => {
          // Keep the handler pending so the soft deadline wins the race.
        }),
      { observability, deadlineBufferMs: 10 },
    );

    const responsePromise = handler(validEvent, { getRemainingTimeInMillis: () => 15 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
    const response = await responsePromise;

    expect(response.statusCode).toBe(504);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'INTERNAL_ERROR',
      message_key: 'api.error.timeout',
      details: { reason: 'lambda_soft_deadline' },
    });
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'ERROR',
      message: 'PH-OS lambda boundary failed',
      result: 'ERROR',
      status_code: 504,
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'req_1',
      route_key: 'GET /cards',
      error_code: 'INTERNAL_ERROR',
      details: { reason: 'lambda_soft_deadline' },
    });
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'InternalErrorCount',
        route_key: 'GET /cards',
        tenant_id: 'tenant_abc123',
        error_code: 'INTERNAL_ERROR',
      }),
    );
  });

  it('returns TENANT_CONTEXT_MISSING when API Gateway claims are absent', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withTenantContext(async () => ({}));
    const response = await handler({ requestContext: { requestId: 'req_2' } });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      request_id: 'req_2',
      error_code: 'TENANT_CONTEXT_MISSING',
      message_key: 'api.error.access_token_required',
    });
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'ERROR',
      message: 'PH-OS lambda boundary failed before tenant context',
      result: 'ERROR',
      status_code: 401,
      tenant_id: 'UNKNOWN',
      user_id: 'UNKNOWN',
      request_id: 'req_2',
      correlation_id: 'req_2',
      route_key: 'UNKNOWN_ROUTE',
      error_code: 'TENANT_CONTEXT_MISSING',
    });
  });

  it('returns VALIDATION_ERROR for malformed JSON bodies', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withTenantContext(async () => ({}));
    const response = await handler({ ...validEvent, body: '{bad json' });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.invalid_json',
    });
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'ERROR',
      message: 'PH-OS lambda boundary failed',
      result: 'ERROR',
      status_code: 400,
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'req_1',
      route_key: 'GET /cards',
      error_code: 'VALIDATION_ERROR',
    });
  });

  it('logs unhandled handler failures with tenant context before returning INTERNAL_ERROR', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(
      async () => {
        throw new Error('database unavailable');
      },
      { observability },
    );

    const response = await handler(validEvent);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'INTERNAL_ERROR',
      message_key: 'api.error.internal',
    });
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'ERROR',
      message: 'PH-OS lambda boundary failed',
      result: 'ERROR',
      status_code: 500,
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'req_1',
      route_key: 'GET /cards',
      error_code: 'INTERNAL_ERROR',
    });
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'InternalErrorCount',
        route_key: 'GET /cards',
        tenant_id: 'tenant_abc123',
        error_code: 'INTERNAL_ERROR',
      }),
    );
    expect(observability.annotations).toContainEqual(
      expect.objectContaining({
        route_key: 'GET /cards',
        tenant_id_hash: hashTenantId('tenant_abc123'),
        error_code: 'INTERNAL_ERROR',
      }),
    );
  });
});
