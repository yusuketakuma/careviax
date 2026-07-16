import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  visitScheduleFindManyMock,
  prescriptionIntakeFindManyMock,
  notificationCreateManyMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
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
          prescriptionIntake: {
            findMany: (args: unknown) => prescriptionIntakeFindManyMock(orgId, args),
          },
          notification: {
            createMany: (args: unknown) => notificationCreateManyMock(orgId, args),
          },
        }),
    );
    visitScheduleFindManyMock.mockImplementation(async (orgId: string) =>
      orgId === 'org_a'
        ? [{ id: 'schedule_a', pharmacist_id: 'pharmacist_a' }]
        : [{ id: 'schedule_b', pharmacist_id: 'pharmacist_b' }],
    );
    dispatchNotificationEventMock.mockResolvedValue(undefined);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });
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

  it('keeps refill reads and notifications pinned to the enumerated organization', async () => {
    prescriptionIntakeFindManyMock.mockImplementation(async (orgId: string) => [
      {
        id: `intake_${orgId}`,
        cycle_id: `cycle_${orgId}`,
        cycle: { case_: { primary_pharmacist_id: `pharmacist_${orgId}` } },
      },
    ]);

    const { checkRefillPrescriptions } = await import('./prescriptions');
    await expect(checkRefillPrescriptions()).resolves.toEqual({ processedCount: 2 });

    expect(prescriptionIntakeFindManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(prescriptionIntakeFindManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_a' }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_b' }),
    );
  });

  it('keeps visit-linkage reads and writes pinned to the enumerated organization', async () => {
    prescriptionIntakeFindManyMock.mockImplementation(async (orgId: string) => [
      {
        id: `intake_${orgId}`,
        org_id: orgId,
        cycle_id: `cycle_${orgId}`,
        source_type: 'refill',
        refill_next_dispense_date: new Date('2026-07-20T00:00:00.000Z'),
        prescription_expiry_date: null,
        cycle: {
          case_: {
            id: `case_${orgId}`,
            patient_id: `patient_${orgId}`,
            primary_pharmacist_id: `pharmacist_${orgId}`,
            patient: { name: 'テスト患者' },
          },
          visit_schedules: [],
          visit_schedule_proposals: [],
        },
      },
    ]);

    const { checkIntakeToVisitLinkage } = await import('./prescriptions');
    await expect(checkIntakeToVisitLinkage()).resolves.toEqual({ processedCount: 2 });

    expect(prescriptionIntakeFindManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(prescriptionIntakeFindManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
    expect(
      withOrgContextMock.mock.calls.every(([orgId]) => orgId === 'org_a' || orgId === 'org_b'),
    ).toBe(true);
  });

  it('creates prescription-expiry batches through the same tenant transaction as the read', async () => {
    prescriptionIntakeFindManyMock.mockImplementation(async (orgId: string) => [
      {
        id: `intake_${orgId}`,
        prescription_expiry_date: new Date('2026-07-18T00:00:00.000Z'),
        cycle: {
          case_: {
            patient_id: `patient_${orgId}`,
            primary_pharmacist_id: `pharmacist_${orgId}`,
          },
        },
      },
    ]);

    const { checkPrescriptionExpiry } = await import('./prescriptions');
    await expect(checkPrescriptionExpiry()).resolves.toEqual({ processedCount: 2 });

    expect(notificationCreateManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({
        data: [expect.objectContaining({ org_id: 'org_a', user_id: 'pharmacist_org_a' })],
      }),
    );
    expect(notificationCreateManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({
        data: [expect.objectContaining({ org_id: 'org_b', user_id: 'pharmacist_org_b' })],
      }),
    );
  });
});
