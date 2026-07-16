import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  careReportFindManyMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  queueRemindersMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  queueRemindersMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { organization: { findMany: organizationFindManyMock } },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));
vi.mock('@/server/services/report-reminders', () => ({
  queueOverdueReportResponseReminders: queueRemindersMock,
}));
vi.mock('../runner', () => ({
  runJob: vi.fn(async (_type: string, work: () => Promise<unknown>) => work()),
}));

import { checkReportDeliveryBacklog } from './reports';

describe('report delivery backlog job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }, { id: 'org_b' }]);
    withOrgContextMock.mockImplementation(
      async (orgId: string, work: (tx: unknown) => Promise<unknown>) =>
        work({ careReport: { findMany: (args: unknown) => careReportFindManyMock(orgId, args) } }),
    );
    careReportFindManyMock.mockImplementation(async (orgId: string) => [
      {
        id: `report_${orgId}`,
        org_id: orgId,
        patient_id: `patient_${orgId}`,
        case_id: `case_${orgId}`,
        report_type: 'monthly',
        status: 'failed',
        created_by: `user_${orgId}`,
        updated_at: new Date('2026-07-17T00:00:00.000Z'),
        delivery_records: [{ status: 'failed', failure_reason: 'delivery_failed' }],
      },
    ]);
    queueRemindersMock.mockResolvedValue({ queued_count: 1 });
  });

  it('pins report reads, task writes, and reminder queues to each organization', async () => {
    await expect(checkReportDeliveryBacklog()).resolves.toEqual({
      processedCount: 2,
      queuedResponseReminders: 2,
    });

    expect(careReportFindManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(careReportFindManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_a', relatedEntityId: 'report_org_a' }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_b', relatedEntityId: 'report_org_b' }),
    );
    expect(queueRemindersMock).toHaveBeenCalledWith(expect.any(Object), 'org_a');
    expect(queueRemindersMock).toHaveBeenCalledWith(expect.any(Object), 'org_b');
    expect(
      withOrgContextMock.mock.calls.every(([orgId]) => orgId === 'org_a' || orgId === 'org_b'),
    ).toBe(true);
  });
});
