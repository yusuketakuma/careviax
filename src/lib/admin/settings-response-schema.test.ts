import { describe, expect, it } from 'vitest';
import {
  adminSettingsProfileResponseSchema,
  adminSettingsResponseSchema,
} from './settings-response-schema';

const validSettingsResponse = {
  data: {
    scope: 'system',
    scope_id: null,
    items: [
      {
        key: 'session_timeout_minutes',
        label: 'セッションタイムアウト',
        value: '30',
        type: 'number',
        min: 5,
        max: 30,
      },
    ],
  },
};

describe('adminSettingsResponseSchema', () => {
  it('accepts a bounded settings response', () => {
    expect(adminSettingsResponseSchema.safeParse(validSettingsResponse).success).toBe(true);
  });

  it('rejects duplicate keys and invalid numeric bounds', () => {
    const duplicate = structuredClone(validSettingsResponse);
    duplicate.data.items.push({ ...duplicate.data.items[0] });
    expect(adminSettingsResponseSchema.safeParse(duplicate).success).toBe(false);

    const invalidBounds = structuredClone(validSettingsResponse);
    invalidBounds.data.items[0] = { ...invalidBounds.data.items[0], min: 31, max: 30 };
    expect(adminSettingsResponseSchema.safeParse(invalidBounds).success).toBe(false);
  });

  it('rejects undeclared response fields', () => {
    expect(
      adminSettingsResponseSchema.safeParse({ ...validSettingsResponse, diagnostic: 'secret' })
        .success,
    ).toBe(false);
  });
});

describe('adminSettingsProfileResponseSchema', () => {
  it('projects only the fields used by the admin settings screen', () => {
    const parsed = adminSettingsProfileResponseSchema.parse({
      data: {
        id: 'user_1',
        name: '管理者',
        defaultSiteId: 'site_1',
        email: 'admin@example.test',
      },
    });

    expect(parsed).toEqual({
      data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' },
    });
  });
});
