import { describe, expect, it } from 'vitest';
import { adminUsersResponseSchema } from './admin-users-response-schema';

function buildUser() {
  return {
    id: 'user_1',
    cognito_linked: true,
    name: '山田 太郎',
    name_kana: 'ヤマダ タロウ',
    email: 'taro@example.com',
    phone: '090-0000-0000',
    role: 'pharmacist',
    site_id: 'site_1',
    site_name: '本店',
    is_active: true,
    account_status: 'active',
    invited_at: '2026-06-01T00:00:00.000Z',
    last_invited_at: '2026-06-02T00:00:00.000Z',
    activated_at: '2026-06-03T00:00:00.000Z',
    deactivated_at: null,
    deactivation_reason: null,
    last_active_at: '2026-06-19T00:00:00.000Z',
    max_daily_visits: 8,
    max_weekly_visits: 30,
    max_travel_minutes: 90,
    can_accept_emergency: true,
    visit_specialties: ['緩和ケア'],
    coverage_area: ['港区'],
    can_dispense: true,
    can_audit_dispense: true,
    can_set: false,
    can_audit_set: false,
    credential_types: ['在宅認定'],
    monthly_visit_count: 12,
    provider_internal: 'not cached',
  };
}

function buildResponse() {
  return {
    data: [buildUser()],
    meta: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'unique_users',
      filters_applied: { site_id: null, include_collaborators: true },
      limit: 500,
    },
  };
}

describe('adminUsersResponseSchema', () => {
  it('accepts the provider contract and strips unused user fields', () => {
    const parsed = adminUsersResponseSchema.parse(buildResponse());
    expect(parsed.data[0]).not.toHaveProperty('provider_internal');
    expect(parsed.meta.visible_count).toBe(parsed.data.length);
  });

  it.each([
    ['legacy root', () => buildResponse().data],
    [
      'duplicate user identity',
      () => {
        const response = buildResponse();
        response.data.push({ ...buildUser(), email: 'other@example.com' });
        response.meta.total_count = 2;
        response.meta.visible_count = 2;
        return response;
      },
    ],
    [
      'duplicate email',
      () => {
        const response = buildResponse();
        response.data.push({ ...buildUser(), id: 'user_2', email: 'TARO@example.com' });
        response.meta.total_count = 2;
        response.meta.visible_count = 2;
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
    [
      'wrong query scope metadata',
      () => {
        const response = buildResponse();
        return {
          ...response,
          meta: {
            ...response.meta,
            filters_applied: { site_id: 'site_1', include_collaborators: false },
          },
        };
      },
    ],
  ])('rejects %s', (_label, payloadFactory) => {
    expect(adminUsersResponseSchema.safeParse(payloadFactory()).success).toBe(false);
  });
});
