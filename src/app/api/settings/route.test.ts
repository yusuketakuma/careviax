import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  settingFindManyMock,
  settingFindFirstMock,
  settingCreateMock,
  settingUpdateMock,
  organizationFindFirstMock,
  organizationUpdateMock,
  pharmacySiteFindFirstMock,
  pharmacySiteUpdateMock,
  userFindFirstMock,
  transactionMock,
} = vi.hoisted(() => ({
  settingFindManyMock: vi.fn(),
  settingFindFirstMock: vi.fn(),
  settingCreateMock: vi.fn(),
  settingUpdateMock: vi.fn(),
  organizationFindFirstMock: vi.fn(),
  organizationUpdateMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  pharmacySiteUpdateMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    setting: {
      findMany: settingFindManyMock,
      findFirst: settingFindFirstMock,
      create: settingCreateMock,
      update: settingUpdateMock,
    },
    organization: {
      findFirst: organizationFindFirstMock,
      update: organizationUpdateMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
      update: pharmacySiteUpdateMock,
    },
    user: {
      findFirst: userFindFirstMock,
    },
    $transaction: transactionMock,
  },
}));

import { GET, PATCH } from './route';

function createRequest(url: string, method: 'GET' | 'PATCH', body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedPatchRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"scope":',
  });
}

describe('/api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindFirstMock.mockResolvedValue({
      name: 'PH-OS薬局',
      corporate_number: '1234567890123',
    });
    userFindFirstMock.mockResolvedValue({ id: 'user_1' });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        organization: { update: organizationUpdateMock },
        pharmacySite: { update: pharmacySiteUpdateMock },
        setting: {
          findFirst: settingFindFirstMock,
          create: settingCreateMock,
          update: settingUpdateMock,
        },
      }),
    );
  });

  it('returns merged system settings with persisted values', async () => {
    settingFindManyMock.mockResolvedValue([
      { key: 'session_timeout_minutes', value: 25 },
      { key: 'mfa_required', value: false },
    ]);

    const response = await GET(createRequest('http://localhost/api/settings?scope=system', 'GET'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        scope: 'system',
        scope_id: null,
        items: expect.arrayContaining([
          expect.objectContaining({
            key: 'session_timeout_minutes',
            value: '25',
          }),
          expect.objectContaining({
            key: 'mfa_required',
            value: 'false',
          }),
        ]),
      },
    });
  });

  it('rejects non-object update payloads before resolving the settings target', async () => {
    const response = await PATCH(createRequest('http://localhost/api/settings', 'PATCH', []), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(organizationFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before resolving the settings target', async () => {
    const response = await PATCH(createMalformedPatchRequest('http://localhost/api/settings'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(organizationFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('updates site-backed fields and setting-backed values for the selected site scope', async () => {
    pharmacySiteFindFirstMock.mockResolvedValue({
      id: 'site_1',
      name: 'PH-OS薬局 本店',
      dispensing_fee_category: '1',
      is_health_support_pharmacy: false,
    });
    settingFindFirstMock.mockResolvedValue(null);
    settingFindManyMock.mockResolvedValue([{ key: 'opening_hours', value: '08:30-18:30' }]);

    const response = await PATCH(
      createRequest('http://localhost/api/settings', 'PATCH', {
        scope: 'site',
        scope_id: 'site_1',
        values: {
          site_name: 'PH-OS薬局 東店',
          dispensing_fee_category: '3',
          is_health_support_pharmacy: 'true',
          opening_hours: '08:30-18:30',
        },
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(pharmacySiteUpdateMock).toHaveBeenCalledWith({
      where: { id: 'site_1' },
      data: {
        name: 'PH-OS薬局 東店',
        dispensing_fee_category: '3',
        is_health_support_pharmacy: true,
      },
    });
    expect(settingCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'site',
        scope_id: 'site_1',
        key: 'opening_hours',
        value: '08:30-18:30',
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        scope: 'site',
        scope_id: 'site_1',
      },
    });
  });

  describe('compliance range enforcement (system numeric settings)', () => {
    it('rejects session_timeout_minutes above the 3省2GL max (31)', async () => {
      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { session_timeout_minutes: '31' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が許容範囲外です',
        details: {
          session_timeout_minutes: [expect.stringContaining('30')],
        },
      });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('accepts session_timeout_minutes at the max boundary (30)', async () => {
      settingFindFirstMock.mockResolvedValue(null);
      settingFindManyMock.mockResolvedValue([{ key: 'session_timeout_minutes', value: 30 }]);

      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { session_timeout_minutes: '30' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      expect(transactionMock).toHaveBeenCalled();
    });

    it('rejects session_timeout_minutes below the min boundary (4)', async () => {
      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { session_timeout_minutes: '4' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        details: {
          session_timeout_minutes: [expect.stringContaining('5')],
        },
      });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('accepts session_timeout_minutes at the min boundary (5)', async () => {
      settingFindFirstMock.mockResolvedValue(null);
      settingFindManyMock.mockResolvedValue([{ key: 'session_timeout_minutes', value: 5 }]);

      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { session_timeout_minutes: '5' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      expect(transactionMock).toHaveBeenCalled();
    });

    it('rejects audit_log_retention_days below the min boundary (364)', async () => {
      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { audit_log_retention_days: '364' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        details: {
          audit_log_retention_days: [expect.stringContaining('365')],
        },
      });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects password_min_length below the min boundary (11)', async () => {
      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { password_min_length: '11' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        details: {
          password_min_length: [expect.stringContaining('12')],
        },
      });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric value for a ranged numeric setting', async () => {
      const response = await PATCH(
        createRequest('http://localhost/api/settings', 'PATCH', {
          scope: 'system',
          values: { session_timeout_minutes: 'abc' },
        }),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        details: {
          session_timeout_minutes: [expect.stringContaining('数値')],
        },
      });
      expect(transactionMock).not.toHaveBeenCalled();
    });
  });
});
