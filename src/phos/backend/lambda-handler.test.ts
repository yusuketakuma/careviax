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
    expect(observability.annotations).toContainEqual({
      route_key: 'GET /cards',
      tenant_id_hash: hashTenantId('tenant_abc123'),
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
  });

  it('emits pre-context EMF logs with UNKNOWN tenant/user and request correlation', async () => {
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
          tenant_id: 'UNKNOWN',
          user_id: 'UNKNOWN',
          request_id: 'req_1',
          correlation_id: 'corr_1',
          TenantBoundaryRejectedCount: 1,
        }),
        expect.objectContaining({
          tenant_id: 'UNKNOWN',
          user_id: 'UNKNOWN',
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
        message: 'PH-OS lambda boundary failed before tenant context',
        tenant_id: 'UNKNOWN',
        user_id: 'UNKNOWN',
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
          error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        }),
        expect.objectContaining({
          name: 'CrossTenantAttemptCount',
          route_key: 'GET /cards',
          error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        }),
      ]),
    );
    expect(observability.security_events).toContainEqual(
      expect.objectContaining({
        event_type: 'TENANT_BOUNDARY_REJECTED',
        request_id: 'req_1',
        route_key: 'GET /cards',
        error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        details: { source: 'body' },
      }),
    );
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
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"error_code":"TENANT_CONTEXT_MISSING"'),
    );
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
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"error_code":"VALIDATION_ERROR"'),
    );
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
