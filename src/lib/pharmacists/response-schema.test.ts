import { describe, expect, it } from 'vitest';
import { pharmacistAdminOptionsResponseSchema } from './response-schema';

function buildResponse() {
  return {
    data: [
      {
        id: 'user_1',
        name: '山田 太郎',
        site_name: '本店',
        role: 'pharmacist',
        email: 'not-cached@example.com',
      },
    ],
    meta: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'memberships',
      filters_applied: { site_id: null, include_collaborators: false },
      limit: 500,
    },
  };
}

describe('pharmacistAdminOptionsResponseSchema', () => {
  it('keeps only staff option fields', () => {
    const parsed = pharmacistAdminOptionsResponseSchema.parse(buildResponse());
    expect(parsed.data[0]).toEqual({
      id: 'user_1',
      name: '山田 太郎',
      site_name: '本店',
      role: 'pharmacist',
    });
  });

  it.each([
    ['legacy root', () => buildResponse().data],
    [
      'collaborator scope',
      () => ({
        ...buildResponse(),
        meta: {
          ...buildResponse().meta,
          count_basis: 'unique_users',
          filters_applied: { site_id: null, include_collaborators: true },
        },
      }),
    ],
    [
      'unsupported role',
      () => ({
        ...buildResponse(),
        data: [{ ...buildResponse().data[0], role: 'clerk' }],
      }),
    ],
    [
      'count drift',
      () => ({ ...buildResponse(), meta: { ...buildResponse().meta, total_count: 2 } }),
    ],
  ])('rejects %s', (_label, payloadFactory) => {
    expect(pharmacistAdminOptionsResponseSchema.safeParse(payloadFactory()).success).toBe(false);
  });
});
