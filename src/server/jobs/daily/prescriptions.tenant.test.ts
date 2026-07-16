import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  visitScheduleFindManyMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: { findMany: organizationFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('../runner', () => ({
  runJob: vi.fn(async (_jobType: string, work: () => Promise<unknown>) => work()),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: vi.fn(),
}));

import { checkMedicationDeadlines } from './prescriptions';

describe('tenant-scoped prescription jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }, { id: 'org_b' }]);
    withOrgContextMock.mockImplementation(
      async (orgId: string, work: (tx: unknown) => Promise<unknown>) =>
        work({
          visitSchedule: {
            findMany: (args: unknown) => visitScheduleFindManyMock(orgId, args),
          },
        }),
    );
    visitScheduleFindManyMock.mockImplementation(async (orgId: string) =>
      orgId === 'org_a'
        ? [{ id: 'schedule_a', pharmacist_id: 'pharmacist_a' }]
        : [{ id: 'schedule_b', pharmacist_id: 'pharmacist_b' }],
    );
    dispatchNotificationEventMock.mockResolvedValue(undefined);
  });

  it('enumerates organizations and keeps every read and notification in its tenant context', async () => {
    await expect(checkMedicationDeadlines()).resolves.toEqual({ processedCount: 2 });

    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_a', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_b', expect.any(Function));
    expect(visitScheduleFindManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_a', explicitUserIds: ['pharmacist_a'] }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_b', explicitUserIds: ['pharmacist_b'] }),
    );
  });
});
