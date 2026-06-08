import { describe, expect, it } from 'vitest';
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
  });

  it('returns TENANT_CONTEXT_MISSING when API Gateway claims are absent', async () => {
    const handler = withTenantContext(async () => ({}));
    const response = await handler({ requestContext: { requestId: 'req_2' } });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      request_id: 'req_2',
      error_code: 'TENANT_CONTEXT_MISSING',
      message_key: 'api.error.access_token_required',
    });
  });

  it('returns VALIDATION_ERROR for malformed JSON bodies', async () => {
    const handler = withTenantContext(async () => ({}));
    const response = await handler({ ...validEvent, body: '{bad json' });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.invalid_json',
    });
  });
});
