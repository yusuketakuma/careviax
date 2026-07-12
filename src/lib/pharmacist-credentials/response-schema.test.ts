import { describe, expect, it } from 'vitest';
import { pharmacistCredentialListResponseSchema } from './response-schema';

function buildCredential(id = 'credential_1') {
  return {
    id,
    user_id: 'user_1',
    user_name: '山田 太郎',
    certification_type: '研修認定',
    certification_number: 'CERT-001',
    issued_date: '2025-04-01T00:00:00.000Z',
    expiry_date: '2028-03-31T00:00:00.000Z',
    tenure_years: 5.5,
    weekly_work_hours: 32,
    consented_patients: [{ id: 'patient_1', name: '患者 一郎' }],
    provider_internal: 'not cached',
  };
}

function buildResponse() {
  return {
    data: [buildCredential()],
    meta: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'pharmacist_credentials',
      filters_applied: {},
      limit: 100,
    },
  };
}

describe('pharmacistCredentialListResponseSchema', () => {
  it('accepts the bounded credential projection and strips provider internals', () => {
    const parsed = pharmacistCredentialListResponseSchema.parse(buildResponse());
    expect(parsed.data[0]).not.toHaveProperty('provider_internal');
  });

  it.each([
    ['legacy root', () => buildResponse().data],
    [
      'duplicate credential identity',
      () => {
        const response = buildResponse();
        response.data.push(buildCredential());
        response.meta.total_count = 2;
        response.meta.visible_count = 2;
        return response;
      },
    ],
    [
      'duplicate patient identity',
      () => {
        const response = buildResponse();
        response.data[0].consented_patients.push({ id: 'patient_1', name: '患者 一郎' });
        return response;
      },
    ],
    [
      'invalid date range',
      () => {
        const response = buildResponse();
        response.data[0].expiry_date = '2024-03-31T00:00:00.000Z';
        return response;
      },
    ],
    [
      'unsafe weekly hours',
      () => {
        const response = buildResponse();
        response.data[0].weekly_work_hours = 169;
        return response;
      },
    ],
    [
      'count drift',
      () => {
        const response = buildResponse();
        response.meta.total_count = 2;
        return response;
      },
    ],
  ])('rejects %s', (_label, payloadFactory) => {
    expect(pharmacistCredentialListResponseSchema.safeParse(payloadFactory()).success).toBe(false);
  });
});
