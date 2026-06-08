import { describe, expect, it } from 'vitest';
import { toErrorLambdaResponse } from './error-response';

describe('PH-OS ErrorResponse contract', () => {
  it('serializes Lambda JSON error responses with request header', () => {
    const response = toErrorLambdaResponse(400, {
      request_id: 'req_2',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      message_key: 'api.error.tenant_id_in_payload_forbidden',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['X-Request-Id']).toBe('req_2');
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_2',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      message_key: 'api.error.tenant_id_in_payload_forbidden',
    });
  });
});
