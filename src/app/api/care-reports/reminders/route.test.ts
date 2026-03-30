import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withOrgContextMock, queueOverdueReportResponseRemindersMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  queueOverdueReportResponseRemindersMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) =>
    handler,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/report-reminders', () => ({
  queueOverdueReportResponseReminders: queueOverdueReportResponseRemindersMock,
}));

import { POST } from './route';

describe('/api/care-reports/reminders POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueOverdueReportResponseRemindersMock.mockResolvedValue({
      queued_count: 2,
      delivery_ids: ['delivery_1', 'delivery_2'],
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({ tx: true })
    );
  });

  it('creates overdue response follow-up tasks', async () => {
    const response = await POST({
      orgId: 'org_1',
      userId: 'user_1',
      json: async () => ({ overdue_days: 5 }),
    } as NextRequest & { orgId: string; userId: string });

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(201);
    expect(queueOverdueReportResponseRemindersMock).toHaveBeenCalledWith(
      { tx: true },
      'org_1',
      { overdueDays: 5 }
    );
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      data: {
        queued_count: 2,
      },
    });
  });
});
