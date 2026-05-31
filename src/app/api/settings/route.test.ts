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
      })
    );
  });

  it('returns merged system settings with persisted values', async () => {
    settingFindManyMock.mockResolvedValue([
      { key: 'session_timeout_minutes', value: 25 },
      { key: 'mfa_required', value: false },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/settings?scope=system', 'GET'),
      { params: Promise.resolve({}) },
    );

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

  it('updates site-backed fields and setting-backed values for the selected site scope', async () => {
    pharmacySiteFindFirstMock.mockResolvedValue({
      id: 'site_1',
      name: 'PH-OS薬局 本店',
      dispensing_fee_category: '1',
      is_health_support_pharmacy: false,
    });
    settingFindFirstMock.mockResolvedValue(null);
    settingFindManyMock.mockResolvedValue([
      { key: 'opening_hours', value: '08:30-18:30' },
    ]);

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
      { params: Promise.resolve({}) }
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
});
