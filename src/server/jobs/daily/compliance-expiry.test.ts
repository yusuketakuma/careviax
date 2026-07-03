import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  facilityStandardRegistrationFindManyMock,
  pharmacistCredentialFindManyMock,
  membershipFindManyMock,
  notificationCreateManyMock,
  taskFindManyMock,
  taskUpdateManyMock,
  withOrgContextMock,
  runJobMock,
} = vi.hoisted(() => ({
  facilityStandardRegistrationFindManyMock: vi.fn(),
  pharmacistCredentialFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facilityStandardRegistration: { findMany: facilityStandardRegistrationFindManyMock },
    pharmacistCredential: { findMany: pharmacistCredentialFindManyMock },
    membership: { findMany: membershipFindManyMock },
    notification: { createMany: notificationCreateManyMock },
    task: { findMany: taskFindManyMock, updateMany: taskUpdateManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('../runner', () => ({
  runJob: runJobMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: vi.fn(),
}));

import { checkCredentialExpiry, checkFacilityStandardExpiry } from './compliance-expiry';

describe('checkFacilityStandardExpiry / checkCredentialExpiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'));
    runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
    withOrgContextMock.mockImplementation(
      async (orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({ orgId }),
    );
    taskFindManyMock.mockResolvedValue([]);
    taskUpdateManyMock.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only notifies each org own admins for its own expiring facility standards (no cross-org notification leak)', async () => {
    facilityStandardRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'facility_std_a',
        org_id: 'org_a',
        standard_type: '在宅患者訪問薬剤管理指導料',
        expiry_date: new Date('2026-07-05T00:00:00.000Z'), // 2 days out -> urgent bucket
        site: { name: '本店' },
      },
      {
        id: 'facility_std_b',
        org_id: 'org_b',
        standard_type: '地域支援体制加算',
        expiry_date: new Date('2026-07-05T00:00:00.000Z'),
        site: { name: '支店' },
      },
    ]);
    // org_a と org_b の admin/owner を明確に分けて返す。
    membershipFindManyMock.mockImplementation(
      async ({ where }: { where: { org_id: { in: string[] } } }) => {
        const orgIds: string[] = where.org_id.in;
        return orgIds.flatMap((orgId) => [{ org_id: orgId, user_id: `admin_${orgId}` }]);
      },
    );
    notificationCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await checkFacilityStandardExpiry();

    expect(result).toEqual({ processedCount: 2 });
    const [{ data }] = notificationCreateManyMock.mock.calls[0] as [
      { data: Array<{ org_id: string; user_id: string; dedupe_key: string }> },
    ];
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          org_id: 'org_a',
          user_id: 'admin_org_a',
          dedupe_key: 'facility-std-expiry:facility_std_a:7',
        }),
        expect.objectContaining({
          org_id: 'org_b',
          user_id: 'admin_org_b',
          dedupe_key: 'facility-std-expiry:facility_std_b:7',
        }),
      ]),
    );
    // org_a の期限切れを org_b の admin へ通知していないこと（テナント越境の漏洩なし）。
    expect(data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ org_id: 'org_a', user_id: 'admin_org_b' }),
      ]),
    );
    expect(data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ org_id: 'org_b', user_id: 'admin_org_a' }),
      ]),
    );
  });

  it('picks the 60-day threshold bucket exactly at the 60-day boundary (boundary)', async () => {
    facilityStandardRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'facility_std_60',
        org_id: 'org_a',
        standard_type: '地域支援体制加算',
        expiry_date: new Date('2026-09-01T00:00:00.000Z'), // exactly 60 days out from 2026-07-03
        site: { name: '本店' },
      },
    ]);
    membershipFindManyMock.mockResolvedValue([{ org_id: 'org_a', user_id: 'admin_1' }]);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });

    await checkFacilityStandardExpiry();

    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          type: 'business',
          dedupe_key: 'facility-std-expiry:facility_std_60:60',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('only notifies each credential org own admins (no cross-org notification leak)', async () => {
    pharmacistCredentialFindManyMock.mockResolvedValue([
      {
        id: 'credential_a',
        org_id: 'org_a',
        user_id: 'pharmacist_a',
        certification_type: '認定薬剤師',
        expiry_date: new Date('2026-07-20T00:00:00.000Z'), // within 30 days -> urgent
        user: { id: 'pharmacist_a', org_id: 'org_a', name: '担当A' },
      },
      {
        id: 'credential_b',
        org_id: 'org_b',
        user_id: 'pharmacist_b',
        certification_type: '認定薬剤師',
        expiry_date: new Date('2026-07-20T00:00:00.000Z'),
        user: { id: 'pharmacist_b', org_id: 'org_b', name: '担当B' },
      },
    ]);
    membershipFindManyMock.mockImplementation(
      async ({ where }: { where: { org_id: { in: string[] } } }) => {
        const orgIds: string[] = where.org_id.in;
        return orgIds.flatMap((orgId) => [{ org_id: orgId, user_id: `admin_${orgId}` }]);
      },
    );
    notificationCreateManyMock.mockResolvedValue({ count: 4 });

    await checkCredentialExpiry();

    const [{ data }] = notificationCreateManyMock.mock.calls[0] as [
      { data: Array<{ org_id: string; user_id: string }> },
    ];
    // org_a の資格失効を org_b の admin へ知らせていないこと。
    expect(data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ org_id: 'org_a', user_id: 'admin_org_b' }),
      ]),
    );
    expect(data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ org_id: 'org_b', user_id: 'admin_org_a' }),
      ]),
    );
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ org_id: 'org_a', user_id: 'admin_org_a' }),
        expect.objectContaining({ org_id: 'org_b', user_id: 'admin_org_b' }),
      ]),
    );
  });
});
