import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTenantContext } from './lambda-handler';

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
    const handler = withTenantContext(async ({ ctx }) => ({
      request_id: ctx.request_id,
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
    }));

    const response = await handler(validEvent);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
    });
  });

  it('rejects tenant_id in body before handler execution', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let called = false;
    const handler = withTenantContext(async () => {
      called = true;
      return {};
    });

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
    const handler = withTenantContext(async () => {
      throw new Error('database unavailable');
    });

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
  });
});
